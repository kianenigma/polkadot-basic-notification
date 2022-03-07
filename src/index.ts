import { ApiPromise, WsProvider } from "@polkadot/api";
import { Header, Address } from "@polkadot/types/interfaces/runtime";
import "@polkadot/api-augment";
import "@polkadot/types-augment";
import { readFileSync } from 'fs';
import { logger } from "./logger";
import { ConsoleReporter, EmailReporter, FileSystemReporter, MatrixReporter, Reporter } from "./reporters"
import { string } from "yargs";
import { type } from "os";

export interface ExtendedAccount {
	address: Address,
	nickname: string
}

interface ConfigInterface {
	accounts: [string, string][],
	endpoints: string[],
	reporters: any,
}

async function perHeader(chain: string, api: ApiPromise, header: Header, accounts: ExtendedAccount[], reporters: Reporter[]) {
	const signedBlock = await api.rpc.chain.getBlock(header.hash);
	const extrinsics = signedBlock.block.extrinsics;
	const blockApi = await api.at(header.hash);
	const events = await blockApi.query.system.events();
	const number = header.number.toNumber();
	const hash = header.hash;

	for (const ext of extrinsics) {
		const maybeMatch = accounts.find((e) => e.address.eq(ext.signer)) || accounts.find((e) => ext.toString().includes(e.address.toString()));
		if (maybeMatch) {
			await Promise.all(reporters.map((r) => r.reportExtrinsic({ hash, chain, number, who: maybeMatch }, ext)))
		}
	}

	for (const event of events.map(e => e.event)) {
		const maybeMatch = accounts.find((e) => event.data.toString().includes(e.address.toString()));
		if (maybeMatch) {
			await Promise.all(reporters.map(r => r.reportEvent({ hash, chain, number, who: maybeMatch }, event)))
		}
	}
}

async function listenChain(ws: string, accounts: [string, string][], reporters: Reporter[]) {
	const provider = new WsProvider(ws);
	const api = await ApiPromise.create({ provider });

	const extendedAccounts: ExtendedAccount[] = accounts.map(([s, n]) => { return { address: api.createType('Address', s), nickname: n } });
	const chain = (await api.rpc.system.chain()).toString()
	logger.info(`⛓ Connected to [${ws}] ${chain} [ss58: ${api.registry.chainSS58}]`)

	const unsub = await api.rpc.chain.subscribeFinalizedHeads(async (header) => {
		logger.debug(`checking block ${header.hash} of ${chain}`);
		await perHeader(chain, api, header, extendedAccounts, reporters)
	});
}

async function listAllChains(config: ConfigInterface, reporters: Reporter[]) {
	const _ = await Promise.all(config.endpoints.map((c) => listenChain(c, config.accounts, reporters)));
	// a rather wacky way to make sure this function never returns.
	return new Promise(() => {});
}

async function main() {
	const config: ConfigInterface = JSON.parse(readFileSync('config.json').toString());
	const reporters: Reporter[] = [];
	for (const reporterType in config.reporters) {
		if (reporterType === "email") {
			const reporter = new EmailReporter(config.reporters[reporterType]);
			await reporter.verify();
			reporters.push(reporter)
		}
		if (reporterType === "console") {
			reporters.push(new ConsoleReporter())
		}
		if (reporterType === "fs") {
			reporters.push(new FileSystemReporter(config.reporters[reporterType]["path"]))
		}
		if (reporterType === "matrix") {
			const reporter = new MatrixReporter(config.reporters[reporterType]);
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
