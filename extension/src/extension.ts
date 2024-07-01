// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import TerminalTool from './tools/terminal';
import * as fs from 'fs';
  
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

type Snippet = {
	filepath: string
	code: string
	language: string
  }
  

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
			],
			
		}
		
		webviewView.webview.html = this._getHtmlForWebview(this._context);

		const superdocsConfig = vscode.workspace.getConfiguration('superdocs');
		
		// const apiKey = superdocsConfig.get("apiKey");
		// const apiUrl = superdocsConfig.get("apiUrl");
		// const modelName = superdocsConfig.get("modelName");

		// const auxiliaryModelName = superdocsConfig.get("auxiliaryModelName");

		// if(!apiKey || !apiUrl){
		// 	vscode.window.showErrorMessage("Superdocs requires your API Keys to work.");
		// 	return;
		// }

		// webviewView.webview.postMessage({
		// 	type: "info",
		// 	content: {
		// 		directory: vscode.workspace.workspaceFolders![0].uri.path,
		// 		apiKey: apiKey,
		// 		apiUrl: apiUrl,
		// 		modelName: modelName,
		// 		auxiliaryModelName: auxiliaryModelName
		// 	}
		// })

		// Mkae sure there is an option to send the directory over manually.

		webviewView.webview.onDidReceiveMessage(data => {
			console.log("Received message from frontend: ", data);
			switch(data.type) {
				case "startedWebview":
					webviewView.webview.postMessage({
						type: "context",
						content: {
							telemetryAllowed: superdocsConfig.get("telemetryAllowed"),

						}
					})
					break;
			}
			if(data.type === "replaceSnippet"){
				// let joinedFilepath = data.content.filepath;
				let joinedFilepath = path.join(vscode.workspace.workspaceFolders![0].uri.path, data.content.filepath);
				let file = fs.readFileSync(joinedFilepath).toString("utf-8");
				console.log("Trying to replace snippet in: ", joinedFilepath, data.content.originalCode, data.content.newCode);
				file = file.replace(data.content.originalCode, data.content.newCode);
				fs.writeFileSync(joinedFilepath, file);
			} else if (data.type === "writeFile") {
				let joinedFilepath = path.join(vscode.workspace.workspaceFolders![0].uri.path, data.content.filepath);
				fs.writeFileSync(joinedFilepath, data.content.code);
			} else if (data.type === "semanticSearch") {
				let requestString = data.query;
				// Ask the backend for relevant queries that should be applied
			} else if (data.type === "getWorkspaceData") {
				(async () => {
					let files: Snippet[] = [];
					const workspaceDirectory = vscode.workspace.workspaceFolders![0].uri.path;

					for(const tabGroup of vscode.window.tabGroups.all){
						for(const tab of tabGroup.tabs) {
							if(tab.input instanceof vscode.TabInputText) {
								let document = await vscode.workspace.openTextDocument(tab.input.uri.fsPath);
								let text = document.getText();

								if(text.length > 17000) {
									vscode.window.showInformationMessage(`Not including: ${document.fileName} - exceeds 17k char limit per file.`);
								} else {
									files.push({
										filepath: path.relative(workspaceDirectory, tab.input.uri.fsPath),
										code: document.getText(),
										language: document.languageId,
									});
									// if a file exceeds a certain character count, don't add it
								}
							}
						}
					}
					webviewView.webview.postMessage({
						type: "processRequest",
						content: {
							snippets: files,
							query: data.content.query
						}
					});
	
					// TODO: add a check for gitignore
				})();				
			}
		});

		let addSnippet = vscode.commands.registerCommand("superdocs.addSnippet", () => {
			console.log("Selecting text");
			const workspaceDirectory = vscode.workspace.workspaceFolders![0].uri.path

			const selection = vscode.window.activeTextEditor?.selection;
			const selectedText = vscode.window.activeTextEditor?.document.getText(selection);
			const language = vscode.window.activeTextEditor?.document.languageId;
			const filepath = path.relative(workspaceDirectory, vscode.window.activeTextEditor?.document.uri.fsPath!);
						
			webviewView.webview.postMessage({
				type: "snippet",
				content: {
					code: selectedText,
					language: language,
					startIndex: undefined,
					endIndex: undefined,
					filepath: filepath,
					directory: workspaceDirectory
				}
			});
		});


		let sendTerminal = vscode.commands.registerCommand("superdocs.sendTerminal", async () => {
			let terminalContent = await this.terminalTool?.getTerminalContent();
			webviewView.webview.postMessage({
				type: "snippet",
				content: {
					code: terminalContent,
					language: "bash",
					startIndex: undefined,
					endIndex: undefined,
					filepath: "User's terminal"
				}
			});
		});

		this._context.subscriptions.push(addSnippet);
		this._context.subscriptions.push(sendTerminal);
	}

	private _getHtmlForWebview(context: vscode.ExtensionContext){
		const jsFile = "vscode.js";
		const cssFile = "vscode.css";
		const localServerUrl = "http://localhost:3000";
	
		let scriptUrl = "";
		let cssUrl = "";
	
		const isProduction = context.extensionMode === vscode.ExtensionMode.Production;
		if (isProduction) {
			scriptUrl = this._view?.webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, 'webview', 'build', jsFile))).toString()!;
			cssUrl = this._view?.webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, 'webview', 'build', cssFile))).toString()!;
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