// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import OpenAI from 'openai';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// 读取配置文件
function loadConfig() {
	try {
		const configPath = path.join(os.homedir(), '.codefixrc.json');
		if (fs.existsSync(configPath)) {
			const configContent = fs.readFileSync(configPath, 'utf8');
			return JSON.parse(configContent);
		}
	} catch (error) {
		console.error('Error loading config:', error);
	}
	return null;
}

// 从AI响应中提取代码
function extractCodeFromResponse(response: string): string {
	// 支持多种代码块格式
	const codeBlockRegex = /```(?:typescript|javascript|ts|js)?\n([\s\S]*?)```/;
	const match = response.match(codeBlockRegex);
	if (match && match[1]) {
		return match[1].trim();
	}
	// 如果没有代码块标记，尝试直接返回清理后的响应
	return response.trim();
}

// 配置OpenAI客户端
const config = loadConfig();
const openai = new OpenAI({
	baseURL: config?.openai?.apiBase || process.env.OPENAI_API_BASE || 'https://api.openai.com/v1',
	apiKey: config?.openai?.apiKey || process.env.OPENAI_API_KEY,
	defaultHeaders: {
		'Content-Type': 'application/json',
	},
});

// 获取文件的诊断信息
async function getDiagnostics(document: vscode.TextDocument): Promise<vscode.Diagnostic[]> {
	const diagnostics = await vscode.languages.getDiagnostics(document.uri);
	return diagnostics;
}

// 构建修复代码的提示词
function buildFixPrompt(code: string, errors: vscode.Diagnostic[], filePath: string): string {
	const errorMessages = errors.map(error => ({
		message: error.message,
		range: {
			start: error.range.start,
			end: error.range.end
		}
	}));

	return `Fix any issues in the following code from file path ${filePath}:

${errorMessages.map(err => `Error: ${err.message} at line ${err.range.start.line + 1}`).join('\n')}

\`\`\`typescript
${code}
\`\`\`


Return the fixed code wrapped in a code block with the language specified (typescript or javascript).`;
}

// 使用AI修复代码
async function fixCodeWithAI(code: string, errors: vscode.Diagnostic[], filePath: string): Promise<string> {
	const prompt = buildFixPrompt(code, errors, filePath);

	try {
		const completion = await openai.chat.completions.create({
			model: config?.openai?.model || "gpt-4-turbo-preview",
			messages: [
				{
					role: "system",
					content: "You are a TypeScript/JavaScript expert. Fix the code according to the errors. Return only the fixed code wrapped in a code block."
				},
				{
					role: "user",
					content: prompt
				}
			],
			temperature: 0.2,
			stream: true,
		});

		let fullResponse = '';
		for await (const chunk of completion) {
			const content = chunk.choices[0]?.delta?.content || '';
			fullResponse += content;
		}

		const fixedCode = extractCodeFromResponse(fullResponse);
		if (!fixedCode) {
			throw new Error('Failed to extract code from AI response');
		}

		return fixedCode;
	} catch (error: unknown) {
		if (error instanceof Error) {
			console.error('Error calling OpenAI:', error.message);
			throw new Error(`Failed to get AI response: ${error.message}`);
		} else {
			console.error('Error calling OpenAI:', error);
			throw new Error('Failed to get AI response: Unknown error');
		}
	}
}

// 修复当前文件
async function fixCurrentFile() {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		vscode.window.showInformationMessage('No active editor');
		return;
	}

	const document = editor.document;
	const diagnostics = await getDiagnostics(document);

	if (diagnostics.length === 0) {
		vscode.window.showInformationMessage('No errors found in the current file');
		return;
	}

	try {
		const progressOptions = {
			location: vscode.ProgressLocation.Notification,
			title: "Fixing code with AI...",
			cancellable: false
		};

		await vscode.window.withProgress(progressOptions, async (progress) => {
			progress.report({ increment: 0 });
			
			const fixedCode = await fixCodeWithAI(
				document.getText(),
				diagnostics,
				document.fileName
			);
			
			progress.report({ increment: 100 });

			await editor.edit((editBuilder: vscode.TextEditorEdit) => {
				const fullRange = new vscode.Range(
					document.positionAt(0),
					document.positionAt(document.getText().length)
				);
				editBuilder.replace(fullRange, fixedCode);
			});
		});

		vscode.window.showInformationMessage('Code fixed successfully!');
	} catch (error: unknown) {
		if (error instanceof Error) {
			vscode.window.showErrorMessage(`Failed to fix code: ${error.message}`);
		} else {
			vscode.window.showErrorMessage('Failed to fix code: Unknown error');
		}
	}
}

// 修复所有文件
async function fixAllFiles() {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders) {
		vscode.window.showInformationMessage('No workspace folder open');
		return;
	}

	const files = await vscode.workspace.findFiles(
		'**/*.{ts,tsx,js,jsx}',
		'**/node_modules/**'
	);

	let fixedCount = 0;
	for (const file of files) {
		const document = await vscode.workspace.openTextDocument(file);
		const diagnostics = await getDiagnostics(document);

		if (diagnostics.length > 0) {
			try {
				const fixedCode = await fixCodeWithAI(document.getText(), diagnostics, file.fsPath);
				const editor = await vscode.window.showTextDocument(document);
				
				await editor.edit((editBuilder: vscode.TextEditorEdit) => {
					const fullRange = new vscode.Range(
						document.positionAt(0),
						document.positionAt(document.getText().length)
					);
					editBuilder.replace(fullRange, fixedCode);
				});

				fixedCount++;
			} catch (error: unknown) {
				if (error instanceof Error) {
					console.error(`Failed to fix ${file.fsPath}:`, error.message);
				} else {
					console.error(`Failed to fix ${file.fsPath}:`, error);
				}
			}
		}
	}

	vscode.window.showInformationMessage(`Fixed ${fixedCount} files successfully!`);
}

// 获取git暂存区的变更
async function getStagedChanges(): Promise<string> {
	try {
		const { stdout } = await execAsync('git diff --cached');
		return stdout;
	} catch (error) {
		throw new Error('Failed to get staged changes');
	}
}

// 使用AI生成commit消息
async function generateCommitMessage(changes: string): Promise<string> {
	try {
		const completion = await openai.chat.completions.create({
			model: config?.openai?.model || "gpt-4-turbo-preview",
			messages: [
				{
					role: "system",
					content: "You are a git commit message expert. Generate a concise and descriptive commit message based on the changes. Follow conventional commit format."
				},
				{
					role: "user",
					content: `Generate a commit message for these changes:\n\n${changes}`
				}
			],
			temperature: 0.2,
		});

		return completion.choices[0]?.message?.content || '';
	} catch (error) {
		throw new Error('Failed to generate commit message');
	}
}

// 执行git commit
async function executeGitCommit(message: string): Promise<void> {
	try {
		// 创建临时文件来存储commit消息
		const tempFile = path.join(os.tmpdir(), 'commit-message.txt');
		fs.writeFileSync(tempFile, message);

		// 使用vim编辑commit消息
		await execAsync(`git commit -F "${tempFile}" --edit`);

		// 清理临时文件
		fs.unlinkSync(tempFile);
	} catch (error) {
		throw new Error('Failed to execute git commit');
	}
}

// AI Commit命令实现
async function aiCommit() {
	try {
		const progressOptions = {
			location: vscode.ProgressLocation.Notification,
			title: "Generating commit message...",
			cancellable: false
		};

		await vscode.window.withProgress(progressOptions, async (progress) => {
			progress.report({ increment: 0 });
			
			// 获取暂存区的变更
			const changes = await getStagedChanges();
			if (!changes) {
				vscode.window.showInformationMessage('No changes staged for commit');
				return;
			}

			// 生成commit消息
			const commitMessage = await generateCommitMessage(changes);
			
			progress.report({ increment: 100 });

			// 执行commit
			await executeGitCommit(commitMessage);
		});

		vscode.window.showInformationMessage('Commit created successfully!');
	} catch (error: unknown) {
		if (error instanceof Error) {
			vscode.window.showErrorMessage(`Failed to create commit: ${error.message}`);
		} else {
			vscode.window.showErrorMessage('Failed to create commit: Unknown error');
		}
	}
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Extension "BitCodeFixer" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let fixCurrentFileDisposable = vscode.commands.registerCommand('bitcodefixer.fixCurrentFile', fixCurrentFile);
	let fixAllErrorsDisposable = vscode.commands.registerCommand('bitcodefixer.fixAllErrors', fixAllFiles);
	let aiCommitDisposable = vscode.commands.registerCommand('bitcodefixer.aiCommit', aiCommit);

	context.subscriptions.push(fixCurrentFileDisposable, fixAllErrorsDisposable, aiCommitDisposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}
