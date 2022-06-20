import yargs from "yargs";
import { readFileSync } from 'fs';
import { Address } from "@polkadot/types/interfaces/runtime";

import { EmailConfig } from './EmailReporter';
import { MatrixConfig } from './MatrixReporter';

export interface ExtendedAccount {
	address: Address,
	label: string
}

export interface AppConfig {
	endpoints: string[],
	accounts: ExtendedAccount[],
	eventFilter: "all" | string[],
	matrix?: MatrixConfig,
	email?: EmailConfig
}

export class Config {

	config: AppConfig;

	constructor() {
		const argv = yargs(process.argv.slice(2))
			.option('c', {
				type: 'string',
				description: 'path to a JSON file with your config in it.',
				default: process.env.APP_CONFIG_FILE,
			}).parseSync();

		if (!argv.c) {
			console.error('-c or APP_CONFIG_FILE env variable must specify a config file');
			process.exit(1);
		}

		this.config = JSON.parse(readFileSync(argv.c).toString());


		// Accounts Filter
		if (this.config.accounts == undefined) {
			console.warn("No 'accounts' section found in config, defaulting to '[]'");
			this.config.accounts = []
		}

		// EventFilter
		if (this.config.eventFilter == undefined) {
			console.warn("No 'eventFilter' section found in config, defaulting to 'all'");
			this.config.eventFilter = "all"
		}
		// Matrix
		// Environment variable overwrites config entry
		if (typeof process.env.MATRIX_TOKEN !== undefined && this.config.matrix !== undefined) {
			this.config.matrix.accessToken = process.env.MATRIX_TOKEN || this.config.matrix.accessToken;
		}
	}

}

