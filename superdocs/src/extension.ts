// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import TerminalTool from './tools/terminal';
import {replaceTextInFile, writeToFile} from './tools/finteract';

import {saveChanges, showChanges, revertChanges} from './tools/change_demo';
  
// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "superdocs" is now active!');

	const provider = new WebviewViewProvider(context.extensionUri, context);

	context.subscriptions.push(vscode.window.registerWebviewViewProvider(WebviewViewProvider.viewType, provider, {
		webviewOptions: {
			retainContextWhenHidden: true
		}
	}));

}

// This method is called when your extension is deactivated
export function deactivate() {}

class WebviewViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'superdocs.superdocsView';
	private _view?: vscode.WebviewView;
	private terminalTool?: TerminalTool;
	private timeLastResponseProcessed?: number;
	private mostRecentResponse?: any;
	private messages?: any[];

	constructor(
		private readonly _extensionUri: vscode.Uri,
		private readonly _context: vscode.ExtensionContext
	) {
		this.terminalTool = new TerminalTool();
		this.messages = [];
		this.timeLastResponseProcessed = 0;
		this.mostRecentResponse = "";
	 }

	public resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken) {
		console.log("Running resolveWebviewView");

		this._view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				this._extensionUri
			],
			
		}
		
		webviewView.webview.html = this._getHtmlForWebview(this._context);

		webviewView.webview.postMessage({
			type: "info",
			content: {
				directory: vscode.workspace.workspaceFolders![0].uri.path
			}
		})

		// Mkae sure there is an option to send the directory over manually.

		webviewView.webview.onDidReceiveMessage(data => {
			console.log("Received message from frontend: ", data);
			if(data.type == "replaceSnippet"){
				replaceTextInFile(data.content.originalCode, data.content.newCode, data.content.filepath);
			} else if (data.type == "writeFile") {
				writeToFile(data.content.text, data.content.filepath);
			} else if (data.type == "sendTerminal") {

			} else if (data.type === "saveCurrent") {
				saveChanges();
			} else if (data.type === "viewChanges") {
				showChanges();
			} else if (data.type === "revertChanges") {
				revertChanges();
			} else if (data.type === "response") {
				this.mostRecentResponse = data.content;
				this.timeLastResponseProcessed = Date.now();
			} else if (data.type === "reset"){
				this.messages = [];
				webviewView.webview.postMessage({
					type: "messages",
					content: this.messages
				});
			}
		});

		let addSnippet = vscode.commands.registerCommand("superdocs.addSnippet", () => {
			console.log("Selecting text");
			const selection = vscode.window.activeTextEditor?.selection;
			const selectedText = vscode.window.activeTextEditor?.document.getText(selection);
			const language = vscode.window.activeTextEditor?.document.languageId;
			const filepath = vscode.window.activeTextEditor?.document.uri.fsPath;
			
			webviewView.webview.postMessage({
				type: "snippet",
				content: {
					code: selectedText,
					language: language,
					startIndex: undefined,
					endIndex: undefined,
					filepath: filepath
				}
			});
		});

		let sendDirectory = vscode.commands.registerCommand("superdocs.sendDirectory", () => {
			webviewView.webview.postMessage({
				type: "info",
				content: {
					directory: vscode.workspace.workspaceFolders![0].uri.path
				}
			})
		})

		this._context.subscriptions.push(addSnippet);
		this._context.subscriptions.push(sendDirectory);
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