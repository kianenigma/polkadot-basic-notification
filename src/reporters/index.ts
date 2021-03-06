import { Hash } from "@polkadot/types/interfaces/runtime";
import { GenericExtrinsic, GenericEvent } from "@polkadot/types/";
import { Codec } from "@polkadot/types-codec/types";
import { logger } from "../logger";
import * as nodemailer from "nodemailer";
import * as openpgp from 'openpgp';
import * as sdk from "matrix-js-sdk";
import { appendFileSync } from "fs";
import { readFileSync } from 'fs'
import { EmailConfig, ExtendedAccount, FsConfig, MatrixConfig, ReportType } from "..";
import { ApiPromise } from "@polkadot/api";

const MAX_FORMATTED_MSG_LEN = 256;

enum COLOR {
	Primary = "#a3e4d7",
}

/// Method of a transaction or an event, e.g. `transfer` or `Deposited`.
export function methodOf(type: ReportType, input: GenericEvent | GenericExtrinsic): string {
	if (type === ReportType.Event) {
		return input.method.toString()
	} else {
		return (input as GenericExtrinsic).meta.name.toString()
	}
}

/// Pallet of a transaction or an event, e.g. `Balances` or `System`.
export function palletOf(type: ReportType, input: GenericEvent | GenericExtrinsic): string {
	if (type === ReportType.Event) {
		// TODO: there's probably a better way for this?
		// @ts-ignore
		return input.toHuman().section
	} else {
		return (input as GenericExtrinsic).method.section.toString()
	}
}

interface ReportInput {
	account: ExtendedAccount,
	type: ReportType,
	pallet: string,
	method: string,
	inner: GenericEvent | GenericExtrinsic;
}

export interface Report {
	hash: Hash,
	number: number,
	chain: string,
	timestamp: number,
	inputs: ReportInput[]
	api: ApiPromise,
}

export interface Reporter {
	report(report: Report): Promise<void>;
}

export class GenericReporter  {
	meta: Report;

	constructor(meta: Report) {
		this.meta = meta;
	}

	trimStr(str: string): string {
		return str.length < MAX_FORMATTED_MSG_LEN ? str : `${str.substring(0, MAX_FORMATTED_MSG_LEN / 2)}..${str.substring(str.length - MAX_FORMATTED_MSG_LEN / 2, str.length)}`
	}

	formatData(data: Codec): string {
		const r = data.toRawType().toLowerCase();
		if (r == "u128" || r.toLowerCase() == "balance") {
			return this.meta.api.createType('Balance', data).toHuman()
		} else {
			return this.trimStr(data.toString())
		}
	}

	subscan(): string {
		return `https://${this.meta.chain.toLowerCase()}.subscan.io/block/${this.meta.number}`
	}

	chain(): string {
		return `<b style="background-color: ${COLOR.Primary}">${this.meta.chain}</b>`
	}

	method(input: ReportInput): string {
		return input.method
	}

	pallet(input: ReportInput): string {
		return input.pallet
	}

	data(input: ReportInput): string {
		if (input.type === ReportType.Event) {
			return `[${(input.inner as GenericEvent).data.map((d) => this.formatData(d)).join(', ')}]`
		} else {
			return `[${(input.inner as GenericExtrinsic).method.args.map((d) => this.formatData(d)).join(', ')}]`
		}
	}

	HTMLTemplate(): string {
		const { api, inputs, ...withoutApi } = this.meta;
		const trimmedInputs = inputs.map(({ account, type, inner }) => { return { account, type, inner: this.trimStr(inner.toString())}});
		// @ts-ignore
		withoutApi.inputs = trimmedInputs;
		return `
<p>
	<p>???? <b> Notification</b> at ${this.chain()} #<a href='${this.subscan()}'>${this.meta.number}</a> aka ${new Date(this.meta.timestamp).toTimeString()}</p>
	<ul>
		${this.meta.inputs.map((i) => `
		<li>
			???? type: ${i.type} | ${i.account === "Wildcard" ? `` : `for <b style="background-color: ${COLOR.Primary}">${i.account.nickname}</b> (${i.account.address})`}
			pallet: <b style="background-color: ${COLOR.Primary}">${this.pallet(i)}</b> |
			method: <b style="background-color: ${COLOR.Primary}">${this.method(i)}</b> |
			data: ${this.data(i)}
		</li>`
	)}
	</ul>
</p>
<details>
	<summary>Raw details</summary>
	<code>${JSON.stringify(withoutApi)}</code>
</details>
`
	}

	rawTemplate(): string {
		return `???? Events at #${this.meta.number}:  ${this.meta.inputs.map((i) => `[???? ${i.type} ${i.account === "Wildcard" ? "" : `for ${i.account.nickname}`} | ???? pallet: ${this.pallet(i)} - method:${this.method(i)} | ???? data: ${this.data(i)}]`)} (${this.subscan()})`
	}
}

export class FileSystemReporter implements Reporter {
	path: string;
	constructor(config: FsConfig) {
		this.path = config.path;
		logger.info(`??? registering file system reporter`)
	}

	report(meta: Report): Promise<void> {
		appendFileSync(this.path, `${new GenericReporter(meta).rawTemplate()}\n`)
		return Promise.resolve()
	}
}

export class ConsoleReporter implements Reporter {
	constructor() {
		logger.info(`??? registering console reporter`)
	}

	report(meta: Report): Promise<void> {
		console.log(new GenericReporter(meta).rawTemplate())
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
		logger.info(`??? registering email reporter from ${this.from} to ${this.to}.`)
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

	async report(meta: Report): Promise<void> {
		const content = new GenericReporter(meta).HTMLTemplate();
		await this.sendEmail(
			`${meta.chain} notifications at #${meta.number}`,
			content,
		)
	}
}

export class MatrixReporter implements Reporter {
	client: sdk.MatrixClient;
	roomId: string;
	constructor(config: MatrixConfig) {
		this.client = sdk.createClient({
			baseUrl: config.server,
			accessToken: config.accessToken,
			userId: config.userId,
		});
		this.roomId = config.roomId;
		logger.info(`??? registering matrix reporter from ${config.userId} to ${this.roomId}@${config.server}.`)
	}

	async report(meta: Report): Promise<void> {
		const innerContent = new GenericReporter(meta).HTMLTemplate();
		const content = {
			"formatted_body": innerContent,
			"body": innerContent,
			"msgtype": "m.text",
			"format": "org.matrix.custom.html",

		};
		await this.client.sendEvent(this.roomId, "m.room.message", content, "");
	}
}

