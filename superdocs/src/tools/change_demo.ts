import * as vscode from 'vscode';

// Represents changes implemented by Langchain
interface LangchainChange {
  range: vscode.Range; // Represents the range of text that could be modified
  content: string;    // Represents the replacement content
}

// Function to save the current code version
async function saveChanges(message: string) {
  const gitExtension = vscode.extensions.getExtension('vscode.git');

  if (gitExtension) {
      const git = gitExtension.exports.getAPI(1);
      const repo = git.repositories[0]; // Assuming there's only one repository

      if (repo) {
          await repo.commit(message);
          vscode.window.showInformationMessage('Changes saved successfully.');
      } else {
          vscode.window.showWarningMessage('No active Git repository.');
      }
  } else {
      vscode.window.showWarningMessage('Git extension is not installed or enabled.');
  }
}

// Shows changes (deletes Langchain changes if user is unsatisfied)
async function showChanges(uri: vscode.Uri, langchainChanges: LangchainChange) {
  try {
      const textDocument = await vscode.workspace.openTextDocument(uri);
      const textEditor = await vscode.window.showTextDocument(textDocument);

      // Apply Langchain changes to the text editor
      textEditor.edit(editBuilder => {
          editBuilder.replace(langchainChanges.range, langchainChanges.content);
      });

      // Ask the user if they want to commit the changes
      const commitChanges = await vscode.window.showInformationMessage(
          'Review Langchain changes. Do you want to commit these changes?',
          'Commit', 'Discard'
      );

      if (commitChanges === 'Commit') {
          // User wants to commit the changes
          const gitExtension = vscode.extensions.getExtension('vscode.git');
          if (gitExtension) {
              const git = gitExtension.exports.getAPI(1);
              const repo = git.repositories[0]; // Assuming there's only one repository

              if (repo) {
                  const changes = await repo.diffWithPrevious(langchainChanges);
                  if (changes.length > 0) {
                      // Only commit if there are actual changes
                      await repo.commit('Langchain changes applied', ...changes);
                      vscode.window.showInformationMessage('Changes committed successfully.');
                  } else {
                      vscode.window.showInformationMessage('No changes to commit.');
                  }
              } else {
                  vscode.window.showWarningMessage('No active Git repository.');
              }
          } else {
              vscode.window.showWarningMessage('Git extension is not installed or enabled.');
          }
      } else {
          // User wants to discard the changes
          vscode.window.showInformationMessage('Changes discarded.');
      }
  } catch (error) {
      console.error('Error:', error);
      vscode.window.showErrorMessage('An error occurred while reviewing changes.');
  }
}

// Namesake functionality
async function revertChanges(commitHash: string) {
  const gitExtension = vscode.extensions.getExtension('vscode.git');

  if (gitExtension) {
      const git = gitExtension.exports.getAPI(1);
      const repo = git.repositories[0];

      if (repo) {
          const sourceControl = repo.sourceControl;
          await sourceControl.revert(commitHash);
          vscode.window.showInformationMessage('Changes reverted successfully.');
      } else {
          vscode.window.showWarningMessage('No active Git repository.');
      }
  } else {
      vscode.window.showWarningMessage('Git extension is not installed or enabled.');
  }
}
