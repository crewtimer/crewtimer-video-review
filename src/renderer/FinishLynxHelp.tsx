import { Container } from '@mui/material';
import ReactMarkdown from 'react-markdown';
import setup from '../assets/LynxSetup.png';

const txt = `
# Integration with FinishLynx
Using the CrewTimer FinishLynx Connector with FinishLynx requires both
CrewTimer and FinishLynx to be in agreement about the configuration.

For a quick overview see the [CrewTimer FinishLynx Connect video](https://www.youtube.com/watch?v=633Bw2ub20Q).

**You must be running FinishLynx 12.10 or later for full functionality**

## Configuration Steps
1. Run CrewTimer FinishLynx Connect and enter your race credentials
2. Specify the FinishLynx Folder to match your FinishLynx Database Input Directory setting.  Usually c:\\Lynx.
This will place a CrewTimer.lss scoreboard file into the specified folder.
3. Start or Restart FinishLynx (v12.10 or later)
4. Set up Scoreboard
   - Create New Scoreboard
      - Script: CrewTimer.lss
      - Serial Port: Network(connect)
      - Port: 5000
      - IP Address: 127.0.0.1 if CrewTimer connect running on same machine
      - Running Time: Off
      - Results:
          - Auto
          - Uncheck Paging
          - Options - checkmark 'Always send place'.  Needed for DNS, DNF support.
          - Time Precison: thousandths
5. Restart FinishLynx to start scoreboard

If you are not using start sensors, set Camera Settings -> Input -> Wired Sensor to "Open"

Your Scoreboard configuration should look like this:
![insert images](LynxSetup.png)

# Other Tips

- Ensure the PC is synchronized using something other than windows default.  For example use [Use Meinberg NTP](https://www.meinbergglobal.com/english/sw/ntp.htm) or [Speedsoft Time Sync](https://www.speed-soft.de/software/time_sync/index.php).

`;
const FinishLynxHelp = () => {
  const uriHandler = (/* uri: string */) => {
    return setup;
  };
  return (
    <Container
      maxWidth="sm"
      style={{
        flexGrow: 1,
        display: 'flex',
        flexFlow: 'column',
        flex: 1,
        paddingBottom: '2em',
      }}
    >
      <ReactMarkdown transformImageUri={uriHandler}>{txt}</ReactMarkdown>
    </Container>
  );
};
export default FinishLynxHelp;
