import { Telegraf } from 'telegraf';
import { ConsoleReporter, GenericReporter, Report, Reporter } from '.';
import { TelegramConfig } from '../config';
import { logger } from '../logger';

export class TelegramReporter implements Reporter {
	name: string;
	bot: Telegraf;
	chatId: string;

	constructor(config: TelegramConfig) {
		this.name = "telegram";
		this.bot = new Telegraf(config.botToken);
		this.chatId = config.chatId;
		logger.info(`✅ [${this.name}] registering telegram reporter using bot ${this.bot} to chat ${this.chatId}`);
	}

	async report(report: Report): Promise<void> {
		const innerContent = new GenericReporter(report).markdownTemplate();
		await this.bot.telegram.sendMessage(this.chatId, innerContent, { parse_mode: 'Markdown' });
	}

	async groupReport(reports: Report[]): Promise<void> {
		const innerContent = reports
			.map((r) => new GenericReporter(r).markdownTemplate())
			.join('\n---\n');
		await this.bot.telegram.sendMessage(this.chatId, innerContent, { parse_mode: 'Markdown' });
	}
}
