const { notarize } = require('@electron/notarize');
const { build } = require('../../package.json');

// Import a .env file with env settings of the form:
// APPLE_ID=glenne@engel.org
// APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
// TEAM_ID=P<snip>4

require('dotenv').config();

exports.default = async function notarizeMacos(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') {
    return;
  }

  // console.log(
  //   'prepping to notarize %s %s %s',
  //   process.env.APPLE_ID,
  //   process.env.APPLE_APP_SPECIFIC_PASSWORD,
  //   process.env.TEAM_ID,
  // );

  if (process.env.CI !== 'true') {
    console.warn('Skipping notarizing step. Packaging is not running in CI');
    return;
  }

  if (
    !('APPLE_ID' in process.env && 'APPLE_APP_SPECIFIC_PASSWORD' in process.env)
  ) {
    console.warn(
      'Skipping notarizing step. APPLE_ID and APPLE_APP_SPECIFIC_PASSWORD env variables must be set',
    );
    return;
  }

  const appName = context.packager.appInfo.productFilename;

  await notarize({
    appBundleId: build.appId,
    tool: 'notarytool',
    appPath: `${appOutDir}/${appName}.app`,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.TEAM_ID,
  });
};
