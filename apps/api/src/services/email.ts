import { config } from '../config';
import { spawn, execSync } from 'child_process';

export interface SendMagicLinkOptions {
    email: string;
    token: string;
    code: string;
    baseUrl?: string;
}

async function sendWithAzure(options: SendMagicLinkOptions, verifyUrl: string): Promise<void> {
    const { EmailClient } = await import('@azure/communication-email');

    const client = new EmailClient(config.azureCommConnectionString!);

    const message = {
        senderAddress: config.emailFrom,
        content: {
            subject: 'Sign in to Just Maple',
            html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 24px;">
            <img src="https://hornbeam.justmaple.app/data/assets/icons/apple-touch.png" alt="Just Maple" style="width: 48px; height: 48px;" />
            <h1 style="color: #D94E3B; margin: 12px 0 0 0; font-size: 24px;">Just Maple</h1>
          </div>
          <p style="color: #333;">Click the button below to sign in:</p>
          <div style="text-align: center; margin: 24px 0;">
            <a href="${verifyUrl}"
               style="display: inline-block; padding: 14px 28px; background: #D94E3B; color: white; text-decoration: none; border-radius: 6px; font-weight: 500;">
              Sign In
            </a>
          </div>
          <div style="text-align: center; margin: 24px 0; padding: 20px; background: #f5f5f5; border-radius: 8px;">
            <p style="color: #666; font-size: 14px; margin: 0 0 8px 0;">Or enter this code:</p>
            <p style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #D94E3B; margin: 0;">${options.code}</p>
          </div>
          <p style="color: #999; font-size: 12px; margin-top: 24px; text-align: center;">
            This code expires in 15 minutes. If you didn't request this, you can ignore this email.
          </p>
        </div>
      `,
            plainText: `Sign in to Just Maple\n\nClick this link to sign in: ${verifyUrl}\n\nOr enter this code: ${options.code}\n\nThis code expires in 15 minutes.`,
        },
        recipients: {
            to: [{ address: options.email }],
        },
    };

    const poller = await client.beginSend(message);
    await poller.pollUntilDone();
    console.log(`Email sent via Azure to ${options.email}`);
}

// Detect available mail command
function findMailCommand(): string | null {
    const commands = ['sendmail', 'mail', 'msmtp'];
    for (const cmd of commands) {
        try {
            execSync(`which ${cmd}`, { stdio: 'ignore' });
            return cmd;
        } catch {
            continue;
        }
    }
    return null;
}

async function sendWithLocalMail(options: SendMagicLinkOptions, verifyUrl: string): Promise<void> {
    const mailCmd = findMailCommand();

    if (!mailCmd) {
        throw new Error('No mail command found. Install sendmail, mailutils, or msmtp.');
    }

    const htmlBody = `<html>
<body style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="text-align: center; margin-bottom: 24px;">
    <img src="https://hornbeam.justmaple.app/data/assets/icons/apple-touch.png" alt="Just Maple" style="width: 48px; height: 48px;" />
    <h1 style="color: #D94E3B; margin: 12px 0 0 0; font-size: 24px;">Just Maple</h1>
  </div>
  <p style="color: #333;">Click the button below to sign in:</p>
  <div style="text-align: center; margin: 24px 0;">
    <a href="${verifyUrl}"
       style="display: inline-block; padding: 14px 28px; background: #D94E3B; color: white; text-decoration: none; border-radius: 6px; font-weight: 500;">
      Sign In
    </a>
  </div>
  <div style="text-align: center; margin: 24px 0; padding: 20px; background: #f5f5f5; border-radius: 8px;">
    <p style="color: #666; font-size: 14px; margin: 0 0 8px 0;">Or enter this code:</p>
    <p style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #D94E3B; margin: 0;">${options.code}</p>
  </div>
  <p style="color: #999; font-size: 12px; margin-top: 24px; text-align: center;">
    This code expires in 15 minutes. If you didn't request this, you can ignore this email.
  </p>
</body>
</html>`;

    const textBody = `Sign in to Just Maple\n\nClick this link to sign in: ${verifyUrl}\n\nOr enter this code: ${options.code}\n\nThis code expires in 15 minutes.`;

    return new Promise((resolve, reject) => {
        if (mailCmd === 'sendmail') {
            const emailContent = `To: ${options.email}
From: ${config.emailFrom}
Subject: Sign in to Just Maple
Content-Type: text/html; charset=utf-8

${htmlBody}`;

            const proc = spawn('sendmail', ['-t']);
            proc.stdin.write(emailContent);
            proc.stdin.end();

            proc.on('close', (code) => {
                if (code === 0) {
                    console.log(`Email sent via sendmail to ${options.email}`);
                    resolve();
                } else {
                    reject(new Error(`sendmail exited with code ${code}`));
                }
            });

            proc.on('error', (err) => {
                reject(new Error(`Failed to start sendmail: ${err.message}`));
            });
        } else if (mailCmd === 'mail') {
            // mail command from mailutils
            const proc = spawn('mail', [
                '-s',
                'Sign in to Just Maple',
                '-a',
                `From: ${config.emailFrom}`,
                '-a',
                'Content-Type: text/html; charset=utf-8',
                options.email,
            ]);

            proc.stdin.write(htmlBody);
            proc.stdin.end();

            proc.on('close', (code) => {
                if (code === 0) {
                    console.log(`Email sent via mail to ${options.email}`);
                    resolve();
                } else {
                    reject(new Error(`mail exited with code ${code}`));
                }
            });

            proc.on('error', (err) => {
                reject(new Error(`Failed to start mail: ${err.message}`));
            });
        } else if (mailCmd === 'msmtp') {
            const emailContent = `To: ${options.email}
From: ${config.emailFrom}
Subject: Sign in to Just Maple
Content-Type: text/html; charset=utf-8

${htmlBody}`;

            const proc = spawn('msmtp', ['-t']);
            proc.stdin.write(emailContent);
            proc.stdin.end();

            proc.on('close', (code) => {
                if (code === 0) {
                    console.log(`Email sent via msmtp to ${options.email}`);
                    resolve();
                } else {
                    reject(new Error(`msmtp exited with code ${code}`));
                }
            });

            proc.on('error', (err) => {
                reject(new Error(`Failed to start msmtp: ${err.message}`));
            });
        }
    });
}

export async function sendMagicLinkEmail(options: SendMagicLinkOptions): Promise<void> {
    const { email, token, baseUrl = 'http://localhost:4200' } = options;
    const verifyUrl = `${baseUrl}/verify?token=${token}`;

    // Always log in dev mode for debugging
    if (config.isDev) {
        console.log('\n========================================');
        console.log('MAGIC LINK');
        console.log('========================================');
        console.log(`Email: ${email}`);
        console.log(`Token: ${token}`);
        console.log(`Verify URL: ${verifyUrl}`);
        console.log('========================================\n');
    }

    // Try Azure first if configured
    if (config.azureCommConnectionString) {
        try {
            console.log(`Sending email via Azure to ${email} from ${config.emailFrom}`);
            await sendWithAzure(options, verifyUrl);
            return;
        } catch (error) {
            console.error('Azure email failed:', error);
            throw error; // Don't silently fall back - surface the error
        }
    } else {
        console.warn('AZURE_COMMUNICATION_CONNECTION_STRING not configured');
    }

    // Fallback to local mail
    try {
        await sendWithLocalMail(options, verifyUrl);
    } catch (error) {
        console.error('Local mail failed:', error);
        // In dev mode, we already logged the URL so don't throw
        if (!config.isDev) {
            throw new Error('Failed to send email');
        }
    }
}
