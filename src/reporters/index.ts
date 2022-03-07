import { Hash } from "@polkadot/types/interfaces/runtime";
import { GenericExtrinsic, GenericEvent } from "@polkadot/types/";
import { AnyTuple } from "@polkadot/types-codec/types";
import { logger } from "../logger";
import * as nodemailer from "nodemailer";
import * as openpgp from 'openpgp';
import * as sdk from "matrix-js-sdk";
import { appendFileSync } from "fs";
import { readFileSync } from 'fs'
import { ExtendedAccount } from "..";

export interface ReportMetadata {
	hash: Hash,
	number: number,
	chain: string,
	who: ExtendedAccount
}

export interface Reporter {
	reportExtrinsic(meta: ReportMetadata, input: GenericExtrinsic | GenericEvent): Promise<void>;
	reportEvent(meta: ReportMetadata, input: GenericEvent): Promise<void>;
}

export class GenericReporter  {
	subscan(meta: ReportMetadata): string {
		return `https://${meta.chain.toLowerCase()}.subscan.io/block/${meta.number}`
	}

	RawEvent(meta: ReportMetadata, input: GenericEvent): string {
		return `🎤 Event at #${meta.number} for ${meta.who.address} aka ${meta.who.nickname}: ${input.method.toString()}(${input.data.map((x) => x.toHuman()).join(', ')}) (${this.subscan(meta)})`
	}

	RawExtrinsic(meta: ReportMetadata, input: GenericExtrinsic<AnyTuple>): string {
		return `📣 Extrinsic at #${meta.number} from ${meta.who.address} aka ${meta.who.nickname}: ${input.meta.name}(${input.method.args.map((x) => x.toString()).join(', ')}) (${this.subscan(meta)})`
	}

	HTMLEvent(meta: ReportMetadata, input: GenericEvent): string {
		return `🎤 Event at #<a href='${this.subscan(meta)}'>${meta.number}</a> for ${meta.who.address} aka ${meta.who.nickname}: ${input.method.toString()}(${input.data.map((x) => x.toHuman()).join(', ')})`
	}

	HTMLExtrinsic(meta: ReportMetadata, input: GenericExtrinsic<AnyTuple>): string {
		return `📣 Extrinsic at #<a href='${this.subscan(meta)}'>${meta.number}</a> from ${meta.who.address} aka ${meta.who.nickname}: ${input.meta.name}(${input.method.args.map((x) => x.toString()).join(', ')})`
	}

}

export class FileSystemReporter extends GenericReporter implements Reporter {
	path: string;
	constructor(path: string) {
		super()
		this.path = path;
		logger.info(`✅ registering file system reporter`)
	}

	reportExtrinsic(meta: ReportMetadata, input: GenericExtrinsic<AnyTuple>): Promise<void> {
		appendFileSync(this.path, `${this.RawExtrinsic(meta, input)}\n`)
		return Promise.resolve()
	}
	reportEvent(meta: ReportMetadata, input: GenericEvent): Promise<void> {
		appendFileSync(this.path, `${this.RawEvent(meta, input)}\n`)
		return Promise.resolve()
	}
}

export class ConsoleReporter extends GenericReporter implements Reporter {
	constructor() {
		super()
		logger.info(`✅ registering console reporter`)
	}

	reportExtrinsic(meta: ReportMetadata, input: GenericExtrinsic<AnyTuple>): Promise<void> {
		console.log(this.RawExtrinsic(meta, input))
		return Promise.resolve()
	}

	reportEvent(meta: ReportMetadata, input: GenericEvent): Promise<void> {
		console.log(this.RawEvent(meta, input))
		return Promise.resolve()
	}
}

export class EmailReporter extends GenericReporter implements Reporter {
	maybePubkey: openpgp.Key | undefined;
	transporter: nodemailer.Transporter;
	from: string;
	to: string;

	constructor(config: any) {
		super();

		if (config.transporter["dkim"]) {
			config.transporter["dkim"]["privateKey"] = readFileSync(config.transporter["dkim"]["privateKey"]).toString()
		}
		const transporter = nodemailer.createTransport(config.transporter);

		if (config.gpgpubkey) {
			openpgp.readKey({ armoredKey: readFileSync(config.gpgpubkey).toString() })
				.then((p) => this.maybePubkey = p);
		}

		this.transporter = transporter;
		this.from = config.from;
		this.to = config.to;
		logger.info(`✅ registering email reporter from ${this.from} to ${this.to}.`)
	}

	async maybeEncrypt(message: string): Promise<string> {
		if (this.maybePubkey) {
			const enc = await openpgp.encrypt({
				message: await openpgp.createMessage({ text: message }),
				encryptionKeys: this.maybePubkey,
			})
			return enc
		} else {
			return message
		}
	}

	async verify(): Promise<boolean> {
		const outcome = await this.transporter.verify();
		logger.debug(`email verification ${outcome}`)
		return outcome;
	}

	async sendEmail(subject: string, text: string): Promise<void> {
		await this.transporter.sendMail({
			from: this.from,
			to: this.to,
			subject,
			html: await this.maybeEncrypt(text),
		});
	}

	async reportExtrinsic(meta: ReportMetadata, input: GenericExtrinsic<AnyTuple>): Promise<void> {
		await this.sendEmail(
			`extrinsic notification in ${meta.chain}`,
			this.HTMLExtrinsic(meta, input)
		)
	}

	async reportEvent(meta: ReportMetadata, input: GenericEvent): Promise<void> {
		await this.sendEmail(
			`event notification in ${meta.chain}`,
			this.HTMLEvent(meta, input)
		)
	}
}

export class MatrixReporter extends GenericReporter implements Reporter {
	client: sdk.MatrixClient;
	roomId: string;
	constructor(config: any) {
		super();
		this.client = sdk.createClient({
			baseUrl: config.server,
			accessToken: config.accessToken,
			userId: config.userId,
		});
		this.roomId = config.roomId;
		logger.info(`✅ registering matrix reporter from ${config.userId} to ${this.roomId}@${config.server}.`)
	}
	async reportEvent(meta: ReportMetadata, input: GenericEvent): Promise<void> {
		const content = {
			"body": this.RawEvent(meta, input),
			"msgtype": "m.text"
		};
		await this.client.sendEvent(this.roomId, "m.room.message", content, "");
	}

	async reportExtrinsic(meta: ReportMetadata, input: GenericExtrinsic<AnyTuple>): Promise<void> {
		const content = {
			"body": this.RawExtrinsic(meta, input),
			"msgtype": "m.text"
		};
		await this.client.sendEvent(this.roomId, "m.room.message", content, "");
	}
}

