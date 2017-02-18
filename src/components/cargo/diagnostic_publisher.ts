import { isAbsolute, join } from 'path';

import { Diagnostic, DiagnosticCollection, Uri, languages } from 'vscode';

import { FileDiagnostic } from './file_diagnostic';

export class DiagnosticPublisher {
    private diagnostics: DiagnosticCollection;

    public constructor() {
        this.diagnostics = languages.createDiagnosticCollection('rust');
    }

    public clearDiagnostics(): void {
        this.diagnostics.clear();
    }

    /**
     * Publishes a diagnostic if the diagnostic wasn't published yet
     */
    public publishDiagnostic(fileDiagnostic: FileDiagnostic, cwd: string): void {
        const { diagnostic, filePath } = fileDiagnostic;
        const absoluteFilePath = isAbsolute(filePath) ? filePath : join(cwd, filePath);
        const filePathUri = Uri.file(absoluteFilePath);

        const oneFileDiagnostics = this.diagnostics.get(filePathUri);

        if (oneFileDiagnostics === undefined) {
            this.diagnostics.set(filePathUri, [diagnostic]);
        } else if (this.isUniqueDiagnostic(diagnostic, oneFileDiagnostics)) {
            this.diagnostics.set(filePathUri, oneFileDiagnostics.concat([diagnostic]));
        }
    }

    private isUniqueDiagnostic(diagnostic: Diagnostic, diagnostics: Diagnostic[]): boolean {
        const foundDiagnostic = diagnostics.find(uniqueDiagnostic => {
            if (!diagnostic.range.isEqual(uniqueDiagnostic.range)) {
                return false;
            }

            if (diagnostic.message !== uniqueDiagnostic.message) {
                return false;
            }

            return true;
        });

        return foundDiagnostic === undefined;
    }
}
