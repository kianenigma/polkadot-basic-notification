import { Telegraf } from 'telegraf';
import { ConsoleReporter, GenericReporter, Report, Reporter } from '.';
import { TelegramConfig } from '../config';
import { logger } from '../logger';

export class TelegramReporter implements Reporter {
	name: string;
	bot: Telegraf;
	chatId: string;
	maxLen: number

	constructor(config: TelegramConfig) {
		this.name = "telegram";
		this.bot = new Telegraf(config.botToken);
		this.chatId = config.chatId;
		this.maxLen = 1024;
		logger.info(`✅ [${this.name}] registering telegram reporter using bot ${this.bot} to chat ${this.chatId}`);
	}

	chunkSubstr(str: string, size: number): string[] {
		const numChunks = Math.ceil(str.length / size)
		const chunks: string[] = new Array(numChunks)

		for (let i = 0, o = 0; i < numChunks; ++i, o += size) {
			chunks[i] = str.substr(o, size)
		}

		return chunks
	}

	async report(report: Report): Promise<void> {
		const innerContent = new GenericReporter(report).markdownTemplate();
		const innerChunks = this.chunkSubstr(innerContent, this.maxLen);
		for (const chunk of innerChunks) {
			await this.bot.telegram.sendMessage(this.chatId, chunk, { parse_mode: 'Markdown' });
		}
	}

	// async groupReport(reports: Report[]): Promise<void> {
	// 	const innerContent = reports
	// 		.map((r) => new GenericReporter(r).markdownTemplate())
	// 		.join('\n---\n');
	// 	await this.bot.telegram.sendMessage(this.chatId, innerContent, { parse_mode: 'Markdown' });
	// }
}
