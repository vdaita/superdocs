// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import * as express from 'express';
import TerminalTool from './tools/terminal';

const app = express();
app.use(express.json());

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "superdocs" is now active!');

	const provider = new WebviewViewProvider(context.extensionUri, context);
	context.subscriptions.push(vscode.window.registerWebviewViewProvider(WebviewViewProvider.viewType, provider));

	app.listen(54321, () => {
		console.log("Extension listening from port 54321");
	});
}

// This method is called when your extension is deactivated
export function deactivate() {}

class WebviewViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'superdocs.superdocsView';
	private _view?: vscode.WebviewView;
	private terminalTool?: TerminalTool;

	constructor(
		private readonly _extensionUri: vscode.Uri,
		private readonly _context: vscode.ExtensionContext
	) {
		this.terminalTool = new TerminalTool();
	 }

	public resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken) {
		console.log("Running resolveWebviewView");

		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				this._extensionUri
			]
		}

		webviewView.webview.html = this._getHtmlForWebview(this._context);

		webviewView.webview.onDidReceiveMessage(data => {
			switch (data.type) {
				case "message":
					// forward the message over to the backend
					break;
			}
		});

		app.post('/messages', (req, res) => {
			webviewView.webview.postMessage({
				type: "messages",
				content: req.body
			});
		});

		app.post("/run_terminal", async (req, res) => {
			let terminalResponse = await this.terminalTool?.runTerminalCommand(req.body.content);
			res.json({
				content: terminalResponse
			});
		});

		app.get("/get_terminal", async (req, res) => {
			let terminalResponse = await this.terminalTool?.getTerminalContent();
			res.json({
				content: terminalResponse
			});
		});
	}

	private _getHtmlForWebview(context: vscode.ExtensionContext){
		const jsFile = "vscode.js";
		const cssFile = "vscode.css";
		const localServerUrl = "http://localhost:3000";
	
		let scriptUrl = "";
		let cssUrl = "";
	
		const isProduction = context.extensionMode === vscode.ExtensionMode.Production;
		if (isProduction) {
			scriptUrl = this._view?.webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, 'dist', jsFile))).toString()!;
			cssUrl = this._view?.webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, 'dist', cssFile))).toString()!;
		} else {
			scriptUrl = `${localServerUrl}/${jsFile}`; 
		}
	
		return `<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			${isProduction ? `<link href="${cssUrl}" rel="stylesheet">` : ''}
		</head>
		<body>
			<div id="root"></div>
	
			<script src="${scriptUrl}" />
		</body>
		</html>`;
	}
}