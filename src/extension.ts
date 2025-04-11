// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import OpenAI from 'openai';
import axios from 'axios';

// 配置OpenAI客户端
const openai = new OpenAI({
	baseURL: process.env.OPENAI_API_BASE || 'https://api.openai.com/v1',
	apiKey: process.env.OPENAI_API_KEY,
	defaultHeaders: {
		'Content-Type': 'application/json',
	},
});

// 获取文件的诊断信息
async function getDiagnostics(document: vscode.TextDocument): Promise<vscode.Diagnostic[]> {
	const diagnostics = await vscode.languages.getDiagnostics(document.uri);
	return diagnostics;
}

// 使用AI修复代码
async function fixCodeWithAI(code: string, errors: vscode.Diagnostic[]): Promise<string> {
	const errorMessages = errors.map(error => ({
		message: error.message,
		range: {
			start: error.range.start,
			end: error.range.end
		}
	}));

	const prompt = `Please fix the following TypeScript/JavaScript code. Here are the errors:
${JSON.stringify(errorMessages, null, 2)}

Code to fix:
\`\`\`typescript
${code}
\`\`\`

Please provide only the fixed code without any explanations.`;

	try {
		const completion = await openai.chat.completions.create({
			model: "gpt-4-turbo-preview",
			messages: [
				{
					role: "system",
					content: "You are a TypeScript/JavaScript expert. Fix the code according to the errors. Return only the fixed code."
				},
				{
					role: "user",
					content: prompt
				}
			],
			temperature: 0.2,
		});

		return completion.choices[0].message.content || code;
	} catch (error: unknown) {
		if (error instanceof Error) {
			console.error('Error calling OpenAI:', error.message);
		} else {
			console.error('Error calling OpenAI:', error);
		}
		throw new Error('Failed to get AI response');
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
		vscode.window.showInformationMessage('Fixing errors with AI...');
		const fixedCode = await fixCodeWithAI(document.getText(), diagnostics);
		
		await editor.edit((editBuilder: vscode.TextEditorEdit) => {
			const fullRange = new vscode.Range(
				document.positionAt(0),
				document.positionAt(document.getText().length)
			);
			editBuilder.replace(fullRange, fixedCode);
		});

		vscode.window.showInformationMessage('Code fixed successfully!');
	} catch (error: unknown) {
		if (error instanceof Error) {
			vscode.window.showErrorMessage('Failed to fix code: ' + error.message);
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
				const fixedCode = await fixCodeWithAI(document.getText(), diagnostics);
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

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Extension "vscode-ai-fixer" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let fixCurrentFileDisposable = vscode.commands.registerCommand('vscode-ai-fixer.fixCurrentFile', fixCurrentFile);
	let fixAllErrorsDisposable = vscode.commands.registerCommand('vscode-ai-fixer.fixAllErrors', fixAllFiles);

	context.subscriptions.push(fixCurrentFileDisposable, fixAllErrorsDisposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}
