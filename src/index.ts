import '@polkadot/api-augment';
import '@polkadot/types-augment';
import { ApiPromise, WsProvider } from '@polkadot/api';
import { GenericExtrinsic, GenericEvent } from '@polkadot/types/';
import { Header } from '@polkadot/types/interfaces/runtime';
import { logger } from './logger';
import {
	NotificationReport,
	Reporter,
	MiscReport,
	NotificationReportType,
	EventInner,
	ExtrinsicInner
} from './reporters';
import { ApiSubscription, AppConfig, ConfigBuilder, MethodSubscription } from './config';
import {
	ConcreteAccount,
	ExtendedAccount,
	matchEventToAccounts,
	matchExtrinsicToAccounts,
	MatchOutcome,
	subscriptionFilter
} from './matching';
import { Codec } from '@polkadot/types-codec/types';

interface GenericNotification {
	type: NotificationReportType;
	data: GenericExtrinsic | GenericEvent;
}

/// The notification class for a single chain.
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
		// we've already checked that all accounts are valid in config.ts
		this.accounts = config.accounts.map((raw) => {
			return { address: api.createType('Address', raw.address), nickname: raw.nickname };
		});
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
		await subFn(async (header) => {
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
					logger.debug(`catching up with a skipped block ${header.number}`);
					await this.perHeader(header);
				});
			} else if (
				lastBlock !== undefined &&
				header.number.toNumber() != lastBlock + 1 &&
				header.number.toNumber() <= lastBlock
			) {
				logger.error(`This makes no sense ${header.number}`);
			} else {
				await this.perHeader(header);
				lastBlock = header.number.toNumber();
			}

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
		const hash = header.hash.toString();
		const timestamp = (await blockApi.query.timestamp.now()).toBn().toNumber();

		const report: NotificationReport = {
			hash,
			chain,
			number,
			timestamp,
			details: [],
			_type: 'notification'
		};

		/// Method of a transaction or an event, e.g. `transfer` or `Deposited`.
		function methodOf(generic: GenericNotification): string {
			if (generic.type == 'event') {
				return generic.data.method.toString();
			} else {
				return (generic.data as GenericExtrinsic).meta.name.toString();
			}
		}

		/// Pallet of a transaction or an event, e.g. `Balances` or `System`.
		function palletOf(generic: GenericNotification): string {
			if (generic.type === 'event') {
				// TODO: there's probably a better way for this?
				// @ts-ignore
				return generic.data.toHuman().section;
			} else {
				return (generic.data as GenericExtrinsic).method.section.toString();
			}
		}

		function innerOf(generic: GenericNotification): EventInner | ExtrinsicInner {
			const s = (d: Codec) => {
				const r = d.toRawType().toLowerCase();
				if (r == 'u128' || r.toLowerCase() == 'balance') {
					// @ts-ignore
					return formatBalance(data);
				} else {
					return d.toString();
				}
			};

			if (generic.type == 'event') {
				const event = generic.data as GenericEvent;
				const ret: EventInner = { data: event.toJSON()['data'], type: 'event' };
				return ret;
			} else {
				const ext = generic.data as GenericExtrinsic;
				const ret: ExtrinsicInner = {
					data: Array.from(ext.method.args).map((d) => s(d)),
					nonce: ext.nonce.toNumber(),
					signer: ext.signer.toString(),
					type: 'extrinsic'
				};
				return ret;
			}
		}

		const processMatchOutcome = (generic: GenericNotification, outcome: MatchOutcome) => {
			if (outcome === true) {
				// it is a wildcard.
				const account: ExtendedAccount = 'Wildcard';
				const pallet = palletOf(generic);
				const method = methodOf(generic);
				const inner = innerOf(generic);
				const reportInput = { account, inner, pallet, method };
				if (subscriptionFilter({ pallet, method }, this.methodSubscription)) {
					report.details.push(reportInput);
				}
			} else if (outcome === false) {
				// it did not match.
			} else {
				// it matched with an account.
				const account = outcome.with;
				const pallet = palletOf(generic);
				const method = methodOf(generic);
				const inner = innerOf(generic);
				const reportInput = { account, inner, pallet, method };
				if (subscriptionFilter({ pallet, method }, this.methodSubscription)) {
					report.details.push(reportInput);
				}
			}
		};

		// check all extrinsics.
		for (const ext of extrinsics) {
			const matchOutcome = matchExtrinsicToAccounts(ext, accounts);
			const generic: GenericNotification = { data: ext, type: 'extrinsic' };
			processMatchOutcome(generic, matchOutcome);
		}

		// check events.
		for (const event of events.map((e) => e.event)) {
			const matchOutcome = matchEventToAccounts(event, accounts);
			const generic: GenericNotification = { data: event, type: 'event' };
			processMatchOutcome(generic, matchOutcome);
		}

		// if events or extrinsics have matched, trigger a report.
		if (report.details.length) {
			await Promise.all(this.reporters.map((r) => r.report(report)));
		}
	}
}

async function listAllChains(config: AppConfig, reporters: Reporter[]) {
	await Promise.all(
		config.endpoints.map(async (e) => {
			const provider = new WsProvider(e, 2500, {}, 10 * 60 * 1000);
			const api = await ApiPromise.create({ provider });
			const chain = (await api.rpc.system.chain()).toString();
			new ChainNotification(api, chain, reporters, config).start();
		})
	);
	// a rather wacky way to make sure this function never returns.
	return new Promise(() => { });
}

async function main() {
	const { config, reporters, configName } = new ConfigBuilder();

	const graceful = () => {
		// if they are batch reporters, clean them.
		reporters.forEach(async (r) => {
			if (r.clean) {
				r.clean();
			}
		});
		logger.error("gracefully shutting down...");
		process.exit()
	}

	process.on('uncaughtException', (err) => {
		console.log(`Caught exception: ${err}`);
	});

	// process.on('exit', graceful)
	process.on('SIGINT', graceful);
	process.on('SIGQUIT', graceful);

	const retry = true;
	while (retry) {
		try {
			// send a startup notification
			const report: MiscReport = {
				time: new Date(),
				message: `program ${configName} restarted`,
				_type: 'misc'
			};
			reporters.forEach(async (r) => {
				await r.report(report);
			});

			await listAllChains(config, reporters);
		} catch (e) {
			// if they are batch reporters, clean them.
			reporters.forEach(async (r) => {
				if (r.clean) {
					r.clean();
				}
			});

			logger.error(`retrying due to error: ${e}`);
		}
	}
}

main().catch(console.error);
