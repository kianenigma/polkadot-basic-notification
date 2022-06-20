import { readFileSync } from 'fs'

import * as nodemailer from "nodemailer";
import * as openpgp from 'openpgp';

export interface EmailConfig {
	from: string,
	to: string[],
	gpgpubkey?: string,
	transporter: any
}

export class EmailReporter {
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
		//logger.info(`✅ registering email reporter from ${this.from} to ${this.to}.`)
	}

	async maybeEncrypt(message: string): Promise<string> {
		if (this.maybePubkey) {
			const enc = await openpgp.encrypt({
				message: await openpgp.createMessage({ text: message }),
				encryptionKeys: this.maybePubkey,
			})
			// Todo: fix?
			return enc as string;
		} else {
			return message
		}
	}

	async verify(): Promise<boolean> {
		const outcome = await this.transporter.verify();
		//logger.debug(`email verification ${outcome}`)
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

}
