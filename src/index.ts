import '@polkadot/api-augment';
import '@polkadot/types-augment';
import { ApiPromise, WsProvider } from '@polkadot/api';
import { GenericExtrinsic, GenericEvent } from '@polkadot/types/';
import { Header } from '@polkadot/types/interfaces/runtime';
import { logger } from './logger';
import { methodOf, palletOf, Report, Reporter, ReportType } from './reporters';
import { ApiSubscription, AppConfig, ConfigBuilder } from './config';
import {
	ConcreteAccount,
	ExtendedAccount,
	matchEventToAccounts,
	matchExtrinsicToAccounts,
	MatchOutcome,
	MethodSubscription,
	subscriptionFilter
} from './matching';

// TODO: full verification of all config fields.
// TODO: Fix the hack of converting all account ids to 'Address' later (must have test that we catch
// wrong ss58 accounts)
// TODO: test case for all json files


class ChainNotification {
	reporters: Reporter[];
	accounts: ConcreteAccount[];
	methodSubscription: MethodSubscription;
	apiSubscription: ApiSubscription;
	chain: string;
	api: ApiPromise;

	constructor(api: ApiPromise, chain: string, reporters: Reporter[], config: AppConfig) {
		this.reporters = reporters;
		this.methodSubscription = config.method_subscription;
		this.apiSubscription = config.api_subscription;
		this.accounts = config.accounts;
		this.api = api;
		this.chain = chain;
	}

	async start() {
		const subFn =
			this.apiSubscription == ApiSubscription.Head
				? this.api.rpc.chain.subscribeNewHeads
				: this.api.rpc.chain.subscribeFinalizedHeads;

		logger.info(`⛓ Starting listen to ${this.chain} [sub: ${this.apiSubscription}]`);

		let lastBlock: number | undefined = undefined;
		const unsub = await subFn(async (header) => {
			logger.debug(`checking block ${header.number} ${header.hash} of ${this.chain}`);
			if (
				lastBlock !== undefined &&
				header.number.toNumber() != lastBlock + 1 &&
				header.number.toNumber() > lastBlock
			) {
				const amountSkipped = header.number.toNumber() - 1 - lastBlock;
				const listOfSkippedBlocks = Array.from(Array(amountSkipped).keys()).map(
					(x) => x + 1 + (lastBlock || 0)
				);

				listOfSkippedBlocks.map(async (n) => {
					const blockHash = await this.api.rpc.chain.getBlockHash(n);
					const header: Header = await this.api.rpc.chain.getHeader(blockHash);
					logger.warn(`catching up with a skipped block ${header.number}`);
					await this.perHeader(header);
				});
			} else if (
				lastBlock !== undefined &&
				header.number.toNumber() != lastBlock + 1 &&
				header.number.toNumber() <= lastBlock
			) {
				logger.error(`This makes no sense ${header.number}`);
			}
			await this.perHeader(header);
			lastBlock = header.number.toNumber();
		});
	}

	async perHeader(header: Header) {
		const chain = this.chain;
		const accounts = this.accounts;
		const signedBlock = await this.api.rpc.chain.getBlock(header.hash);
		const extrinsics = signedBlock.block.extrinsics;
		const blockApi = await this.api.at(header.hash);
		const events = await blockApi.query.system.events();
		const number = header.number.toNumber();
		const hash = header.hash;
		const timestamp = (await blockApi.query.timestamp.now()).toBn().toNumber();

		const report: Report = { hash, chain, number, timestamp, inputs: [] };

		const processMatchOutcome = (
			type: ReportType,
			inner: GenericExtrinsic | GenericEvent,
			outcome: MatchOutcome
		) => {
			if (outcome === true) {
				// it is a wildcard.
				const account: ExtendedAccount = 'Wildcard';
				const pallet = palletOf(type, inner);
				const method = methodOf(type, inner);
				const reportInput = { account, type, inner, pallet, method };
				if (subscriptionFilter({ pallet, method }, this.methodSubscription)) {
					report.inputs.push(reportInput);
				}
			} else if (outcome === false) {
				// it did not match.
			} else {
				// it matched with an account.
				const matched = outcome.with;
				const pallet = palletOf(type, inner);
				const method = methodOf(type, inner);
				const reportInput = { account: matched, type, inner, method, pallet };
				if (subscriptionFilter({ pallet, method }, this.methodSubscription)) {
					report.inputs.push(reportInput);
				}
			}
		};

		// check all extrinsics.
		for (const ext of extrinsics) {
			const type = ReportType.Extrinsic;
			const matchOutcome = matchExtrinsicToAccounts(ext, accounts);
			processMatchOutcome(type, ext, matchOutcome);
		}

		// check events.
		for (const event of events.map((e) => e.event)) {
			const type = ReportType.Event;
			const matchOutcome = matchEventToAccounts(event, accounts);
			processMatchOutcome(type, event, matchOutcome);
		}

		// if events or extrinsics have matched, trigger a report.
		if (report.inputs.length) {
			await Promise.all(this.reporters.map((r) => r.report(report)));
		}
	}
}

async function listAllChains(config: AppConfig, reporters: Reporter[]) {
	const _ = await Promise.all(
		config.endpoints.map(async (e) => {
			const provider = new WsProvider(e);
			const api = await ApiPromise.create({ provider });
			const chain = (await api.rpc.system.chain()).toString();
			// NOTE: bit of a hack, we must convert all addresses to a legit address type after we
			// have build the API.
			config.accounts = config.accounts.map(({ address, nickname }) => {
				return { nickname, address: api.createType('Address', address) };
			});
			new ChainNotification(api, chain, reporters, config).start();
		})
	);
	// a rather wacky way to make sure this function never returns.
	return new Promise(() => { });
}

async function main() {
	const { config, reporters } = new ConfigBuilder();

	const retry = true;
	while (retry) {
		try {
			await listAllChains(config, reporters);
			// this is just to make sure we NEVER reach this code. The above function never returns,
			// unless if we trap in an exception.
			process.exit(1);
		} catch (e) {
			logger.error(`retrying due to error: ${e}`);
		}
	}
}

main().catch(console.error);
