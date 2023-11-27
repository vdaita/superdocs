// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import * as express from 'express';
import TerminalTool from './tools/terminal';
import replaceTextInFile from './tools/finteract';
import axios from 'axios';
import { spawn } from 'node:child_process';
import { WebviewOptions } from 'vscode';

import {saveChanges, showChanges, revertChanges} from './tools/change_demo';
import { ChildProcessWithoutNullStreams } from 'child_process';

const app = express();
app.use(express.json());

app.get('/', (req, res) => {
	res.send('Hello World!');
});
  
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
	private snippets?: any[];
	private serverSpawn?: ChildProcessWithoutNullStreams;
	private serverData?: string;

	constructor(
		private readonly _extensionUri: vscode.Uri,
		private readonly _context: vscode.ExtensionContext
	) {
		this.terminalTool = new TerminalTool();
		this.messages = [];
		this.timeLastResponseProcessed = 0;
		this.mostRecentResponse = "";
		this.snippets = [];
		this.serverData = "";
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

		webviewView.webview.onDidReceiveMessage(data => {
			console.log("Received message from frontend: ", data);
			if(data.type == "replaceSnippet"){
				replaceTextInFile(data.content.originalCode, data.content.newCode, data.content.filepath);
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
			} else if (data.type === "deleteSnippet") {
				this.snippets?.splice(data.content.index, 1);
				webviewView.webview.postMessage({
					type: "snippets",
					content: this.snippets
				})
			} else if (data.type === "setSnippetsToPast"){
				for(var i = 0; i < this.snippets!.length; i++){
					this.snippets![i].isCurrent = false;
				}
				webviewView.webview.postMessage({
					type: "snippets",
					content: this.snippets
				})
			} else if (data.type === "startServer") {
				console.log("Running _startServer")
				this._startServer(webviewView.webview);
			} else if (data.type === "stopServer") {
				console.log("Running _stopServer")
				this._stopServer();
			} else if (data.type === "clearServerOutput") {
				this.serverData = "";
				webviewView.webview.postMessage({
					type: "serverData",
					content: this.serverData
				})
			}
		});

		let addSnippet = vscode.commands.registerCommand("superdocs.addSnippet", () => {
			console.log("Selecting text");
			const selection = vscode.window.activeTextEditor?.selection;
			const selectedText = vscode.window.activeTextEditor?.document.getText(selection);
			const language = vscode.window.activeTextEditor?.document.languageId;
			const filepath = vscode.window.activeTextEditor?.document.uri.path;
			const relativeFilepath = path.relative(vscode.workspace.workspaceFolders![0].uri.path, filepath!);

			this.snippets?.push({
				code: selectedText,
				language: language,
				filepath: relativeFilepath,
				isCurrent: true
			});
			
			webviewView.webview.postMessage({
				type: "snippets",
				content: this.snippets
			});
		});

		let addTerminal = vscode.commands.registerCommand("superdocs.addTerminal", () => {
			console.log("Adding terminal content");
			let content = this.terminalTool?.getTerminalContent();

			this.snippets?.push({
				code: content,
				language: "terminal",
				filepath: "User terminal output"
			})

			webviewView.webview.postMessage({
				type: "snippet",
				content: this.snippets
			})
		});

		this._context.subscriptions.push(addTerminal);
		this._context.subscriptions.push(addSnippet);

		app.get("/get_user_response", async (req, res) => {
			console.log("Request to /get_user_response: ", req.body);
			webviewView.webview.postMessage({
				type: "responseRequest"
			});
			let requestTime = Date.now();
			while(this.timeLastResponseProcessed! < requestTime){
				console.log("Checking response: ", this.timeLastResponseProcessed, requestTime);
				await new Promise(resolve => setTimeout(resolve, 100));
			}
			res.send({
				message: this.mostRecentResponse
			});
		});

		app.post('/messages', (req, res) => {
			console.log("Request to /messages: ", req.body);
			this.messages!.push(req.body);
			webviewView.webview.postMessage({
				type: "messages",
				content: this.messages
			});
			res.send({"ok": true})
		});

		app.listen(54322, () => {
			console.log(`Example app listening on port 54322`)
		});
	}

	private _startServer(webview: vscode.Webview){

		if(!vscode.workspace.workspaceFolders){
			vscode.window.showInformationMessage("Superdocs: you must have a project open to start the server");
		}

		// 2 conditions: does it end in .py or not?
		let serverPath: string | undefined = vscode.workspace.getConfiguration("superdocs").get("pythonServerPath");
		let openAiApiKey: string | undefined = vscode.workspace.getConfiguration("superdocs").get("openAiApiKey");
		let directory: string = vscode.workspace.workspaceFolders![0].uri.path;

		
		if(!serverPath || !openAiApiKey){
			vscode.window.showErrorMessage("Superdocs: you need to set both the server path and the OpenAI api key for this to work");
			return;
		} else {
			vscode.window.showInformationMessage("Superdocs: starting server");
			if(serverPath.split(".").at(-1) == "py") {
				this.serverSpawn = spawn("conda run -n superdocs python -u", [serverPath, directory, openAiApiKey], {
					shell: true
				});
			} else {
				this.serverSpawn = spawn(serverPath);
			}
			this.serverSpawn.stdout.on("data", (data) => {
				console.log("server data: ", data);
				this.serverData += data;
				webview.postMessage({
					type: "serverData",
					content: this.serverData
				});
			});
			this.serverSpawn.stderr.on("data", (data) => {
				console.log("server data: ", data);
				this.serverData += data;
				webview.postMessage({
					type: "serverData",
					content: this.serverData
				});
			});
			this.serverSpawn.on('exit',  (exitCode) => {
				console.log("Exited with code: " + exitCode);
				this.serverData += "\n Exited with code: " + exitCode;
				webview.postMessage({
					type: "serverData",
					content: this.serverData
				});
			});
			  
		}
	}

	private _stopServer(){
		vscode.window.showInformationMessage("Stopping server");
		this.serverSpawn?.kill();
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