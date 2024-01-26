import { IpcRendererEvent } from 'electron';
import { UseDatum } from 'react-usedatum';

interface UserMessage {
  level: string;
  msg: string;
}
export const [useUserMessages, setUserMessages, getUserMessages] = UseDatum<
  UserMessage[]
>([]);
export const userMessage = {
  info: (msg: string) => {
    const messages = getUserMessages();
    messages.push({ level: 'info', msg });
    setUserMessages(messages, true);
  },
};

window.Util.onUserMessage(
  (_event: IpcRendererEvent, level: string, msg: string) => {
    // console.log(`${level}: ${msg}`);
    if (level === 'info') {
      userMessage.info(msg);
    } else {
      userMessage.info(`Unsupported user message level: ${level}`);
    }
  }
);
