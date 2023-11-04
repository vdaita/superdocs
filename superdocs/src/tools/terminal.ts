import * as vscode from "vscode";

export default class TerminalTool {
    constructor(){

    }

    public async runTerminalCommand(command: string): Promise<string>{
        let terminal: vscode.Terminal;
        if(!(await this._terminalIsAvailable())){
            terminal = vscode.window.createTerminal();
        } else {
            terminal = vscode.window.activeTerminal!;
        }

        let code = this._randomString(10); 

        terminal.sendText(`echo "STARTING ${code}" && ${command} && echo "FINISHED ${code}"`);

        let finishedCode = `FINISHED ${code}`;
        let terminalOutput;
        for(var i = 0; i < 15; i++){
            await this._timeout(500);
            terminalOutput = await this.getTerminalContent();
            const splitOutput = terminalOutput.split("\n");
            if(splitOutput.length >= 2){
                if(splitOutput.at(-2)!.includes(finishedCode)){
                    return terminalOutput;
                }
            }
        }

        terminalOutput = await this.getTerminalContent();
        return terminalOutput;
    }

    private async _terminalIsAvailable(): Promise<boolean> {
        if(!vscode.window.activeTerminal){
            return false;
        }

        let code = this._randomString(17);
        vscode.window.activeTerminal?.sendText(`echo ${code}`);
        await this._timeout(500);
        let terminalContent = await this.getTerminalContent();
        var count = (terminalContent.match(/is/g) || []).length;
        return (count == 2);
    }

    private _randomString(length: number): string{
        return Math.round((Math.pow(36, length + 1) - Math.random() * Math.pow(36, length))).toString(36).slice(1);
    }

    private _timeout(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    public async getTerminalContent(){
        if(!vscode.window.activeTerminal){
            vscode.window.showInformationMessage("Could not get terminal contents: no active terminal");
            return "";
        }

        let previousClipboardContent = await vscode.env.clipboard.readText();
        await vscode.commands.executeCommand('workbench.action.terminal.selectAll');
        await vscode.commands.executeCommand('workbench.action.terminal.copySelection');
        await vscode.commands.executeCommand('workbench.action.terminal.clearSelection');
        let clipboardContent = await vscode.env.clipboard.readText();

        let terminalName = vscode.window.activeTerminal.name;

        await vscode.env.clipboard.writeText(previousClipboardContent);

        return `Terminal name: ${terminalName} \n \n Content: ${clipboardContent}`;
    }
}