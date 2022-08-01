module.exports = {
	apps: [
		{
			name: 'polkadot-basic-notifications',
			script: 'yarn run start -c config-dev.json',
			autorestart: true,
			watch: true,
			env: {
				LOG_LEVEL: 'info'
			}
		}
	]
};
