import { ApiPromise, WsProvider } from "@polkadot/api";
import { Header, Address } from "@polkadot/types/interfaces/runtime";
import "@polkadot/api-augment";
import "@polkadot/types-augment";
import { readFileSync } from 'fs';
import { logger } from "./logger";
import { ConsoleReporter, EmailReporter, FileSystemReporter, MatrixReporter, Report, Reporter } from "./reporters"
import yargs from "yargs";

const argv = yargs(process.argv.slice(2))
	.option('c', {
		type: 'string',
		description: 'path to a JSON file with your config in it.',
		default: process.env.DOT_NOTIF_CONF,
	}).parseSync()

export enum ReportType {
	Event = "Event",
	Extrinsic = "Extrinsic",
}

export interface ExtendedAccount {
	address: Address,
	nickname: string
}

export interface EmailConfig {
	from: string,
	to: string[],
	gpgpubkey?: string,
	transporter: any
}

export interface MatrixConfig {
	userId: string,
	accessToken: string,
	roomId: string,
	server: string,
}

export interface FsConfig {
	path: string,
}

interface ReportersConfig {
	email?: EmailConfig,
	matrix?: MatrixConfig,
	fs?: FsConfig,
	console?: any,
}

enum Subscription {
	Head = "head",
	Finalized = "finalized",
}

interface AppConfig {
	accounts: [string, string][],
	endpoints: string[],
	listen: Subscription,
	reporters: ReportersConfig,
}



async function perHeader(chain: string, api: ApiPromise, header: Header, accounts: ExtendedAccount[], reporters: Reporter[]) {
	const signedBlock = await api.rpc.chain.getBlock(header.hash);
	const extrinsics = signedBlock.block.extrinsics;
	const blockApi = await api.at(header.hash);
	const events = await blockApi.query.system.events();
	const number = header.number.toNumber();
	const hash = header.hash;
	const timestamp = (await blockApi.query.timestamp.now()).toBn().toNumber()

	const report: Report = { api, hash, chain, number, timestamp, inputs: [] }
	for (const ext of extrinsics) {
		const type = ReportType.Extrinsic;
		const maybeMatch = accounts.find((e) => e.address.eq(ext.signer)) || accounts.find((e) => ext.toString().includes(e.address.toString()));
		if (maybeMatch) {
			report.inputs.push({account: maybeMatch, type, inner: ext })
		}
	}

	for (const event of events.map(e => e.event)) {
		const type = ReportType.Event
		const maybeMatch = accounts.find((e) => event.data.toString().includes(e.address.toString()));
		if (maybeMatch) {
			report.inputs.push({account: maybeMatch, type, inner: event })
		}
	}

	if (report.inputs.length) {
		await Promise.all(reporters.map((r) => r.report(report)))
	}
}

async function listenChain(ws: string, subscription: Subscription, accounts: [string, string][], reporters: Reporter[]): Promise<void> {
	const provider = new WsProvider(ws);
	const api = await ApiPromise.create({ provider });

	const extendedAccounts: ExtendedAccount[] = accounts.map(([s, n]) => { return { address: api.createType('Address', s), nickname: n } });
	const chain = (await api.rpc.system.chain()).toString()
	const subFn = subscription == Subscription.Head ? api.rpc.chain.subscribeNewHeads: api.rpc.chain.subscribeFinalizedHeads;

	logger.info(`⛓ Connected to [${ws}] ${chain} [ss58: ${api.registry.chainSS58}] [listening: ${subscription}]`)
	const unsub = await subFn(async (header) => {
		logger.debug(`checking block ${header.hash} of ${chain}`);
		await perHeader(chain, api, header, extendedAccounts, reporters)
	});
}

async function listAllChains(config: AppConfig, reporters: Reporter[]) {
	const _ = await Promise.all(config.endpoints.map((c) => listenChain(c, config.listen, config.accounts, reporters)));
	// a rather wacky way to make sure this function never returns.
	return new Promise(() => {});
}

async function main() {
	if (!argv.c) {
		logger.error('-c or DOT_NOTIF_CONF env variable must specify a config file');
		process.exit(1);
	}
	const config: AppConfig = JSON.parse(readFileSync(argv.c).toString());

	if (config.listen !== Subscription.Finalized && config.listen !== Subscription.Head) {
		logger.warn(`"listen" config not provided or invalid (${config.listen}), overwriting to ${Subscription.Finalized}`);
		config.listen = Subscription.Finalized;
	}

	const reporters: Reporter[] = [];
	for (const reporterType in config.reporters) {
		if (reporterType === "email") {
			const reporter = new EmailReporter(config.reporters[reporterType] as EmailConfig);
			await reporter.verify();
			reporters.push(reporter)
		}
		if (reporterType === "console") {
			reporters.push(new ConsoleReporter())
		}
		if (reporterType === "fs") {
			reporters.push(new FileSystemReporter(config.reporters[reporterType] as FsConfig))
		}
		if (reporterType === "matrix") {
			const reporter = new MatrixReporter(config.reporters[reporterType] as MatrixConfig);
			reporters.push(reporter)
		}
	}

	config.accounts.forEach(([address, nick]) => logger.info(`📇 registering address ${address} aka ${nick}.`))

	const retry = true;
	while (retry) {
		try {
			await listAllChains(config, reporters);
			// this is just to make sure we NEVER reach this code. The above function never returns,
			// unless if we trap in an exception.
			process.exit(1);
		} catch (e) {
			logger.error(`retrying due to error: ${e}`)
		}

	}
}

main().catch(console.error);
