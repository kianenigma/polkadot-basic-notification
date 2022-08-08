import { logger } from '../logger';
import { readFileSync } from 'fs';
import {
	ConsoleReporter,
	EmailReporter,
	FileSystemReporter,
	MatrixReporter,
	Reporter
} from '../reporters';
import * as yaml from 'js-yaml';
import yargs from 'yargs';
import { ConcreteAccount, MethodSubscription } from '../matching';

const ENV_CONFIG = 'DOT_NOTIF_CONF';

export const argv = yargs(process.argv.slice(2))
	.option('c', {
		type: 'string',
		description: 'path to a JSON file with your config in it.',
		default: process.env[ENV_CONFIG]
	})
	.parseSync();

export interface EmailConfig {
	from: string;
	to: string[];
	gpgpubkey?: string;
	transporter: any;
}

export interface MatrixConfig {
	userId: string;
	accessToken: string;
	roomId: string;
	server: string;
}

export interface FsConfig {
	path: string;
}

export interface ReportersConfig {
	email?: EmailConfig;
	matrix?: MatrixConfig;
	fs?: FsConfig;
	console?: unknown;
}

export enum ApiSubscription {
	Head = 'head',
	Finalized = 'finalized'
}

export interface AppConfig {
	accounts: ConcreteAccount[];
	endpoints: string[];
	method_subscription: MethodSubscription;
	api_subscription: ApiSubscription;
	reporters: ReportersConfig;
}

export interface App {
	config: AppConfig;
	reporters: Reporter[];
}

export class ConfigBuilder {
	config: AppConfig;
	reporters: Reporter[];

	constructor() {
		if (!argv.c) {
			logger.error('-c or DOT_NOTIF_CONF env variable must specify a config file');
			process.exit(1);
		}

		const anyConfig = ConfigBuilder.loadConfig(argv.c);
		const config = ConfigBuilder.verifyConfig(anyConfig);

		if (config.reporters.matrix !== undefined) {
			try {
				config.reporters.matrix.userId =
					process.env.MATRIX_USERID || config.reporters.matrix.userId;
				config.reporters.matrix.accessToken =
					process.env.MATRIX_ACCESSTOKEN || config.reporters.matrix.accessToken;
			} catch (error) {
				console.error('Error connecting to Matrix: ', error);
				process.exit(1);
			}
		}

		const reporters: Reporter[] = [];
		for (const reporterType in config.reporters) {
			if (reporterType === 'email') {
				const reporter = new EmailReporter(config.reporters[reporterType] as EmailConfig);
				reporters.push(reporter);
			}
			if (reporterType === 'console') {
				reporters.push(new ConsoleReporter());
			}
			if (reporterType === 'fs') {
				reporters.push(new FileSystemReporter(config.reporters[reporterType] as FsConfig));
			}
			if (reporterType === 'matrix') {
				const reporter = new MatrixReporter(config.reporters[reporterType] as MatrixConfig);
				reporters.push(reporter);
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
		return yaml.load(readFileSync(path, 'utf8'))
	}

	static verifyConfig(config: any): AppConfig {
		const missing = (f: string) => {
			logger.error(`aborting due to missing config field ${f}`);
			process.exit(1);
		};

		if (!config.accounts) missing('accounts');
		if (!config.endpoints) missing('endpoints');
		if (!config.method_subscription) missing('method_subscription');
		if (!config.api_subscription) missing('api_subscription');
		if (!config.reporters) missing('reporters');

		return config as AppConfig;
	}
}
