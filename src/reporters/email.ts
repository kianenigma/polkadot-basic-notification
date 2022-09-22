import * as openpgp from 'openpgp';
import * as nodemailer from 'nodemailer';
import { GenericReporter, Report, Reporter } from '.';
import { EmailConfig } from '../config';
import { readFileSync } from 'fs';
import { logger } from '../logger';

export class EmailReporter implements Reporter {
	maybePubkey: openpgp.Key | undefined;
	transporter: nodemailer.Transporter;
	from: string;
	to: string[];

	constructor(config: EmailConfig) {
		if (config.transporter['dkim']) {
			config.transporter['dkim']['privateKey'] = readFileSync(
				config.transporter['dkim']['privateKey']
			).toString();
		}
		const transporter = nodemailer.createTransport(config.transporter);

		if (config.gpgpubkey) {
			openpgp
				.readKey({ armoredKey: readFileSync(config.gpgpubkey).toString() })
				.then((p) => (this.maybePubkey = p));
		}

		this.transporter = transporter;
		this.from = config.from;
		this.to = config.to;
		logger.info(`✅ registering email reporter from ${this.from} to ${this.to}.`);
	}

	async maybeEncrypt(message: string): Promise<openpgp.WebStream<string>> {
		if (this.maybePubkey) {
			const enc = await openpgp.encrypt({
				message: await openpgp.createMessage({ text: message }),
				encryptionKeys: this.maybePubkey
			});
			return enc;
		} else {
			return message;
		}
	}

	async sendEmail(subject: string, text: string): Promise<void> {
		await Promise.all(
			this.to.map(async (to) =>
				this.transporter.sendMail({
					from: this.from,
					to,
					subject,
					html: await this.maybeEncrypt(text)
				})
			)
		);
	}

	async report(meta: Report): Promise<void> {
		const content = new GenericReporter(meta).htmlTemplate();
		await this.sendEmail(`notification from polkadot-basic-notification`, content);
	}
}
