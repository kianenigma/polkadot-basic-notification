import { GenericReporter, Reporter } from '.';
import { logger } from '../logger';

export class ConsoleReporter implements Reporter {
	constructor() {
		logger.info(`✅ registering console reporter`);
	}

	report(meta: Report): Promise<void> {
		console.log(new GenericReporter(meta).rawTemplate());
		return Promise.resolve();
	}
}
