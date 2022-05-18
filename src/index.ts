import { ApiPromise, WsProvider } from "@polkadot/api";
import { Header, Address } from "@polkadot/types/interfaces/runtime";
import "@polkadot/api-augment";
import "@polkadot/types-augment";
import { readFileSync } from 'fs';
import { logger } from "./logger";
import { ConsoleReporter, EmailReporter, FileSystemReporter, MatrixReporter, methodOf, Report, Reporter } from "./reporters"
import yargs from "yargs";
import { GenericEvent, GenericExtrinsic } from "@polkadot/types";

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

enum ApiSubscription {
	Head = "head",
	Finalized = "finalized",
}

// my best effort at creating rust-style enums, as per explained here: https://www.jmcelwa.in/posts/rust-like-enums/
interface Only {
	only: string[],
}
interface Ignore {
	ignore: string[]
}
type MethodSubscription = "all" | Only | Ignore;

interface AppConfig {
	accounts: [string, string][],
	endpoints: string[],
	method_subscription: MethodSubscription,
	listen?: any,
	reporters: ReportersConfig,
}

function missingAppConfig(arg: any): string {
	if (!arg.accounts) return "accounts";
	if (!arg.endpoints) return "endpoints";
	if (!arg.method_subscription) return "method_subscription";
	if (!arg.reporters) return "reporters";
	return ""
}

interface Matched {
	with: ExtendedAccount
}

type MatchOutcome = false | Matched | true;

function matchEventToAccounts(event: GenericEvent, accounts: ExtendedAccount[]): MatchOutcome {
	if (accounts.length == 0) {
		return true
	} else {
		const maybeMatch = accounts.find((e) => event.data.toString().includes(e.address.toString()));
		if (maybeMatch) {
			return { with: maybeMatch }
		} else {
			return false
		}
	}
}

function matchExtrinsicToAccounts(ext: GenericExtrinsic, accounts: ExtendedAccount[]): MatchOutcome {
	if (accounts.length == 0) {
		return true
	} else {
		const maybeMatch =
			accounts.find((e) => e.address.eq(ext.signer)) ||
			accounts.find((e) => ext.toString().includes(e.address.toString()));
		if (maybeMatch) {
			return { with: maybeMatch }
		} else {
			return false
		}
	}
}

function methodFilter(method: string, sub: MethodSubscription): boolean {
	if (Object.keys(sub).includes("only")) {
		const only = (sub as Only).only;
		return only.some((o) => o === method)
	} else if (Object.keys(sub).includes("ignore")) {
		const ignore = (sub as Ignore).ignore;
		return !ignore.includes(method)
	} else {
		logger.warn('no parsable value for "method_subscription", accepting method anyways.. use explicit "all".');
		return true
	}
}

async function perHeader(
	chain: string,
	api: ApiPromise,
	header: Header,
	accounts: ExtendedAccount[],
	reporters: Reporter[],
	methodSub: MethodSubscription
) {
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
		const matchOutcome = matchExtrinsicToAccounts(ext, accounts);
		if (matchOutcome === true) {
			// it is a wildcard.
			const account: ExtendedAccount = { address: api.createType('Address', new Uint8Array(32)), nickname: "WILDCARD" }
			const reportInput = { account, type, inner: ext };
			const method = methodOf(reportInput);
			if (methodFilter(method, methodSub)) {
				report.inputs.push(reportInput)
			}
		} else if (matchOutcome === false) {
			// it did not match.
		} else {
			// it matched with an account.
			const matched = matchOutcome.with;
			const reportInput = {account: matched, type, inner: ext };
			const method = methodOf(reportInput);
			if (methodFilter(method, methodSub)) {
				report.inputs.push(reportInput)
			}
		}
	}

	for (const event of events.map(e => e.event)) {
		const type = ReportType.Event;
		const matchOutcome = matchEventToAccounts(event, accounts);
		if (matchOutcome === true) {
			// it is a wildcard.
			const account: ExtendedAccount = { address: api.createType('Address', new Uint8Array(32)), nickname: "WILDCARD" }
			const reportInput = { account, type, inner: event };
			const method = methodOf(reportInput);
			if (methodFilter(method, methodSub)) {
				report.inputs.push(reportInput)
			}
		} else if (matchOutcome === false) {
			// it did not match.
		} else {
			// it matched with an account.
			const matched = matchOutcome.with;
			const reportInput = {account: matched, type, inner: event };
			const method = methodOf(reportInput);
			if (methodFilter(method, methodSub)) {
				report.inputs.push(reportInput)
			}
		}
	}

	if (report.inputs.length) {
		await Promise.all(reporters.map((r) => r.report(report)))
	}
}

async function listenChain(ws: string, subscription: ApiSubscription, accounts: [string, string][], methodSub: MethodSubscription, reporters: Reporter[]): Promise<void> {
	const provider = new WsProvider(ws);
	const api = await ApiPromise.create({ provider });

	const extendedAccounts: ExtendedAccount[] = accounts.map(([s, n]) => { return { address: api.createType('Address', s), nickname: n } });
	const chain = (await api.rpc.system.chain()).toString()
	const subFn = subscription == ApiSubscription.Head ? api.rpc.chain.subscribeNewHeads: api.rpc.chain.subscribeFinalizedHeads;

	logger.info(`⛓ Connected to [${ws}] ${chain} [ss58: ${api.registry.chainSS58}] [listening: ${subscription}]`)
	const unsub = await subFn(async (header) => {
		logger.debug(`checking block ${header.hash} of ${chain}`);
		await perHeader(chain, api, header, extendedAccounts, reporters, methodSub)
	});
}

async function listAllChains(config: AppConfig, reporters: Reporter[]) {
	const _ = await Promise.all(config.endpoints.map((e) => listenChain(e, config.listen, config.accounts, config.method_subscription, reporters)));
	// a rather wacky way to make sure this function never returns.
	return new Promise(() => {});
}

async function main() {
	if (!argv.c) {
		logger.error('-c or DOT_NOTIF_CONF env variable must specify a config file');
		process.exit(1);
	}

	const config: AppConfig = JSON.parse(readFileSync(argv.c).toString());
	const missingField = missingAppConfig(config);
	if (missingField) {
		logger.error(`missing some key in config file: ${missingField}`);
		process.exit(1);
	}

	if (config.listen !== ApiSubscription.Finalized && config.listen !== ApiSubscription.Head) {
		logger.warn(`"listen" config not provided or invalid (${config.listen}), overwriting to ${ApiSubscription.Finalized}`);
		config.listen = ApiSubscription.Finalized;
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

	if (config.accounts.length) {
		config.accounts.forEach(([address, nick]) => logger.info(`📇 registering address ${address} aka ${nick}.`))
	} else {
		logger.info(`⚠️ no list of accounts provided, this will match with anything.`);
	}
	logger.info(`👂 method subscription: ${JSON.stringify(config.method_subscription)}`);

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
