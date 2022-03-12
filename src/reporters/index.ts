import { Hash } from "@polkadot/types/interfaces/runtime";
import { GenericExtrinsic, GenericEvent } from "@polkadot/types/";
import { AnyTuple, Codec } from "@polkadot/types-codec/types";
import { logger } from "../logger";
import * as nodemailer from "nodemailer";
import * as openpgp from 'openpgp';
import * as sdk from "matrix-js-sdk";
import { appendFileSync } from "fs";
import { readFileSync } from 'fs'
import { EmailConfig, ExtendedAccount, ReportType } from "..";
import { ApiPromise } from "@polkadot/api";

export interface ReportMetadata {
	hash: Hash,
	number: number,
	chain: string,
	timestamp: number,
	who: ExtendedAccount,
	type: ReportType,
	api: ApiPromise,
}

export interface Reporter {
	report(meta: ReportMetadata, input: GenericExtrinsic | GenericEvent): Promise<void>;

}

type ReportInput = GenericEvent | GenericExtrinsic;

enum COLOR {
	Primary = "#d98880",
}
export class GenericReporter  {
	meta: ReportMetadata;
	input: GenericEvent | GenericExtrinsic;

	constructor(meta: ReportMetadata, input: ReportInput) {
		this.meta = meta;
		this.input = input;
	}

	formatData(data: Codec): string {
		const r = data.toRawType().toLowerCase();
		if (r == "u128" || r.toLowerCase() == "balance") {
			return this.meta.api.createType('Balance', data).toHuman()
		} else {
			return data.toString()
		}
	}

	subscan(): string {
		return `https://${this.meta.chain.toLowerCase()}.subscan.io/block/${this.meta.number}`
	}

	chain(): string {
		return `<b style="background-color: ${COLOR.Primary}">${this.meta.chain}</b>`
	}

	method(): string {
		if (this.meta.type === ReportType.Event) {
			return this.input.method.toString()
		} else {
			return (this.input as GenericExtrinsic).meta.name.toString()
		}
	}

	data(): string {
		if (this.meta.type === ReportType.Event) {
			return `[${(this.input as GenericEvent).data.map((d) => this.formatData(d)).join(', ')}]`
		} else {
			return `[${(this.input as GenericExtrinsic).method.args.map((d) => this.formatData(d)).join(', ')}]`
		}
	}

	HTMLTemplate(): string {
		const { api, ...strippedMeta } = this.meta;
		return `
<p>
	<ul>
	<li>📣 <b>${this.meta.type} Notification</b> at ${this.chain()} #<a href='${this.subscan()}'>${this.meta.number}</a> aka ${new Date(this.meta.timestamp).toTimeString()}</li>
	<li>🧾 For <i>${this.meta.who.address}</i> aka <b>${this.meta.who.nickname}</b></li>
	<li>💻 method: <b style="background-color: ${COLOR.Primary}">${this.method()}</b></li>
	<li>💽 data: ${this.data()}</li>
	</ul>
</p>
<details>
	<summary>Raw details</summary>
	<code>${JSON.stringify({ ...strippedMeta, ...this.input })}</code>
</details>
`
	}

	rawTemplate(): string {
		return `🎤 Event at #${this.meta.number} for ${this.meta.who.address} aka ${this.meta.who.nickname}: ${this.method()}(${this.data()}) (${this.subscan()})`
	}
}

export class FileSystemReporter implements Reporter {
	path: string;
	constructor(path: string) {
		this.path = path;
		logger.info(`✅ registering file system reporter`)
	}

	report(meta: ReportMetadata, input: GenericExtrinsic<AnyTuple>): Promise<void> {
		appendFileSync(this.path, `${new GenericReporter(meta, input).rawTemplate()}\n`)
		return Promise.resolve()
	}
}

export class ConsoleReporter implements Reporter {
	constructor() {
		logger.info(`✅ registering console reporter`)
	}

	report(meta: ReportMetadata, input: GenericExtrinsic<AnyTuple>): Promise<void> {
		console.log(new GenericReporter(meta, input).rawTemplate())
		return Promise.resolve()
	}
}

export class EmailReporter implements Reporter {
	maybePubkey: openpgp.Key | undefined;
	transporter: nodemailer.Transporter;
	from: string;
	to: string[];

	constructor(config: EmailConfig) {
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
		await Promise.all(this.to.map(async (to) =>
			this.transporter.sendMail({
				from: this.from,
				to,
				subject,
				html: await this.maybeEncrypt(text),
			})
		));
	}

	async report(meta: ReportMetadata, input: GenericExtrinsic<AnyTuple>): Promise<void> {
		const content = new GenericReporter(meta, input).HTMLTemplate();
		await this.sendEmail(
			`extrinsic notification in ${meta.chain}`,
			content,
		)
	}
}

export class MatrixReporter implements Reporter {
	client: sdk.MatrixClient;
	roomId: string;
	constructor(config: any) {
		this.client = sdk.createClient({
			baseUrl: config.server,
			accessToken: config.accessToken,
			userId: config.userId,
		});
		this.roomId = config.roomId;
		logger.info(`✅ registering matrix reporter from ${config.userId} to ${this.roomId}@${config.server}.`)
	}

	async report(meta: ReportMetadata, input: GenericExtrinsic<AnyTuple>): Promise<void> {
		const innerContent = new GenericReporter(meta, input).HTMLTemplate();
		const content = {
			"formatted_body": innerContent,
			"body": innerContent,
			"msgtype": "m.text",
			"format": "org.matrix.custom.html",

		};
		await this.client.sendEvent(this.roomId, "m.room.message", content, "");
	}
}

