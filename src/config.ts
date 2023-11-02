import { logger } from './logger';
import { readFileSync } from 'fs';
import {
	BatchReporter,
	ConsoleReporter,
	EmailReporter,
	FileSystemReporter,
	MatrixReporter,
	Reporter
} from './reporters';
import * as yaml from 'js-yaml';
import yargs from 'yargs';
import { isAddress } from '@polkadot/util-crypto';
import * as t from 'ts-interface-checker';
import AppConfigTI, { BatchConfig } from './config-ti';
import { TelegramReporter } from './reporters/telegram';
import { createHash } from 'crypto';
import { TextEncoder } from 'util';

const ENV_CONFIG = 'DOT_NOTIF_CONF';

export const argv = yargs(process.argv.slice(2))
	.option('c', {
		type: 'string',
		description: 'path to a JSON file with your config in it.',
		default: process.env[ENV_CONFIG]
	})
	.parseSync();

export interface Only {
	type: 'only';
	only: ISubscriptionTarget[];
}

export interface Ignore {
	type: 'ignore';
	ignore: ISubscriptionTarget[];
}

export interface All {
	type: 'all';
}

export type MethodSubscription = All | Only | Ignore;

export interface ISubscriptionTarget {
	pallet: string;
	method: string;
}

export interface RawAccount {
	address: string;
	nickname: string;
}

export interface BatchConfig {
	interval: number;
	misc?: boolean;
	leftovers?: boolean
}

export interface EmailConfig {
	from: string;
	to: string[];
	gpgpubkey?: string;
	transporter: any;
	batch?: BatchConfig;
}

export interface MatrixConfig {
	userId: string;
	accessToken: string;
	roomId: string;
	server: string;
	batch?: BatchConfig;
}

export interface FsConfig {
	path: string;
	batch?: BatchConfig;
}

export interface ConsoleConfig {
	batch?: BatchConfig;
}

export interface TelegramConfig {
	chatId: string;
	botToken: string;
	batch?: BatchConfig;
}

export interface ReportersConfig {
	email?: EmailConfig;
	matrix?: MatrixConfig;
	fs?: FsConfig;
	telegram?: TelegramConfig;
	console?: ConsoleConfig;
}

export enum ApiSubscription {
	Head = 'head',
	Finalized = 'finalized'
}

export interface AppConfig {
	accounts: RawAccount[];
	endpoints: string[];
	method_subscription: MethodSubscription;
	api_subscription: ApiSubscription;
	reporters: ReportersConfig;
}

function maybeBatchify<R extends Reporter>(
	reporter: R,
	type: string,
	batchConfig?: BatchConfig
): R | BatchReporter<R> {
	if (batchConfig && batchConfig.interval) {
		const hash = createHash('sha256')
			.update(new TextEncoder().encode(JSON.stringify(reporter)))
			.digest('hex');
		return new BatchReporter(reporter, batchConfig, `batch-${hash}`);
	} else {
		return reporter;
	}
}

export class ConfigBuilder {
	config: AppConfig;
	reporters: Reporter[];
	configName: string;

	constructor() {
		if (!argv.c) {
			logger.error('-c or DOT_NOTIF_CONF env variable must specify a config file');
			process.exit(1);
		}

		const anyConfig = ConfigBuilder.loadConfig(argv.c);
		const config = ConfigBuilder.verifyConfig(anyConfig);
		this.configName = argv.c;

		if (config.reporters.matrix !== undefined) {
			config.reporters.matrix.userId = process.env.MATRIX_USERID || config.reporters.matrix.userId;
			config.reporters.matrix.accessToken =
				process.env.MATRIX_ACCESSTOKEN || config.reporters.matrix.accessToken;
		}

		const reporters: Reporter[] = [];
		for (const reporterType in config.reporters) {
			if (reporterType === 'email') {
				const rConf = config.reporters[reporterType] as EmailConfig;
				const reporter = new EmailReporter(rConf);
				reporters.push(maybeBatchify(reporter, reporterType, rConf.batch));
			}
			if (reporterType === 'console') {
				const rConf = config.reporters[reporterType] as ConsoleConfig;
				const reporter = new ConsoleReporter();
				reporters.push(maybeBatchify(reporter, reporterType, rConf.batch));
			}
			if (reporterType == 'telegram') {
				const rConf = config.reporters[reporterType] as TelegramConfig;
				const reporter = new TelegramReporter(rConf);
				reporters.push(maybeBatchify(reporter, reporterType, rConf.batch));
			}
			if (reporterType === 'fs') {
				const rConf = config.reporters[reporterType] as FsConfig;
				const reporter = new FileSystemReporter(rConf);
				reporters.push(maybeBatchify(reporter, reporterType, rConf.batch));
			}
			if (reporterType === 'matrix') {
				const rConf = config.reporters[reporterType] as MatrixConfig;
				const reporter = new MatrixReporter(rConf);
				reporters.push(maybeBatchify(reporter, reporterType, rConf.batch));
			}
		}

		if (config.accounts.length) {
			config.accounts.map(({ address, nickname }) => {
				logger.info(`📇 registering address ${address} aka ${nickname}.`);
			});
		} else {
			logger.info(`⚠️ no list of accounts provided, this will match with anything.`);
		}

		logger.info(`👂 method method_subscription: ${JSON.stringify(config.method_subscription)}`);

		this.config = config;
		this.reporters = reporters;
	}

	static loadConfig(path: string): unknown {
		return yaml.load(readFileSync(path, 'utf8'));
	}

	static verifyConfig(config: any): AppConfig {
		const error = (f: string) => {
			logger.error(`aborting due to error ${f}`);
			process.exit(1);
		};

		const checker = t.createCheckers(AppConfigTI);
		checker.AppConfig.check(config);
		const parsedConfig = config as AppConfig;

		if (!parsedConfig.accounts.every((a) => isAddress(a.address.toString())))
			error('invalid account address');

		return parsedConfig;
	}
}
