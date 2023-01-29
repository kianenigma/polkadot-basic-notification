import { GenericReporter, Report, Reporter } from '.';
import { logger } from '../logger';

export class ConsoleReporter implements Reporter {
	name: string;
	constructor() {
		this.name = 'console';
		logger.info(`✅ [${this.name}] registering console reporter`);
	}

	report(report: Report): Promise<void> {
		console.log(new GenericReporter(report).rawTemplate());
		return Promise.resolve();
	}
}
