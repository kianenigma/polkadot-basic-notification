module.exports = {
	apps: [
		{
			name: 'polkadot-basic-notifications',
			script: 'bun run ./src/index.ts -c config-dev-all.json',
			autorestart: true,
			watch: true,
			env: {
				LOG_LEVEL: 'info'
			}
		}
	]
};
