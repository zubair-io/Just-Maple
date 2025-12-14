import { config } from '../config';
import { spawn, execSync } from 'child_process';

export interface SendMagicLinkOptions {
    email: string;
    token: string;
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
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #667eea;">Just Maple</h1>
          <p>Click the button below to sign in:</p>
          <a href="${verifyUrl}"
             style="display: inline-block; padding: 12px 24px; background: #667eea; color: white; text-decoration: none; border-radius: 4px; margin: 16px 0;">
            Sign In
          </a>
          <p style="color: #666; font-size: 14px;">
            Or copy this link: <br>
            <a href="${verifyUrl}">${verifyUrl}</a>
          </p>
          <p style="color: #999; font-size: 12px;">
            This link expires in 15 minutes. If you didn't request this, you can ignore this email.
          </p>
        </div>
      `,
            plainText: `Sign in to Just Maple\n\nClick this link to sign in: ${verifyUrl}\n\nThis link expires in 15 minutes.`,
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
<body style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
  <h1 style="color: #667eea;">Just Maple</h1>
  <p>Click the button below to sign in:</p>
  <a href="${verifyUrl}"
     style="display: inline-block; padding: 12px 24px; background: #667eea; color: white; text-decoration: none; border-radius: 4px; margin: 16px 0;">
    Sign In
  </a>
  <p style="color: #666; font-size: 14px;">
    Or copy this link: <br>
    <a href="${verifyUrl}">${verifyUrl}</a>
  </p>
  <p style="color: #999; font-size: 12px;">
    This link expires in 15 minutes. If you didn't request this, you can ignore this email.
  </p>
</body>
</html>`;

    const textBody = `Sign in to Just Maple\n\nClick this link to sign in: ${verifyUrl}\n\nThis link expires in 15 minutes.`;

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
            await sendWithAzure(options, verifyUrl);
            return;
        } catch (error) {
            console.error('Azure email failed, falling back to sendmail:', error);
        }
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
