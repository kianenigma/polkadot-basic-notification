import { Telegraf } from 'telegraf';
import { GenericReporter, Report, Reporter } from '.';
import { logger } from '../logger';

export interface TelegramConfig {
	botToken: string;
	chatId: string;
}

export class TelegramReporter implements Reporter {
	bot: Telegraf;
	chatId: string;

	constructor(config: TelegramConfig) {
		this.bot = new Telegraf(config.botToken);
		this.chatId = config.chatId;
		logger.info(`✅ registering telegram reporter using bot ${this.bot} to chat ${this.chatId}`);
	}

	async report(report: Report): Promise<void> {
		const innerContent = new GenericReporter(report).markdownTemplate();
		await this.bot.telegram.sendMessage(this.chatId, innerContent, { parse_mode: 'Markdown' });
	}
}
