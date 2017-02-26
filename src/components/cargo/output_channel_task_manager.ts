import { join } from 'path';

import { DiagnosticCollection, languages, window } from 'vscode';

import { ConfigurationManager } from '../configuration/configuration_manager';

import ChildLogger from '../logging/child_logger';

import { DiagnosticParser } from './diagnostic_parser';

import { normalizeDiagnosticPath, addUniqueDiagnostic } from './diagnostic_utils';

import { OutputChannelWrapper } from './output_channel_wrapper';

import { OutputChannelTaskStatusBarItem } from './output_channel_task_status_bar_item';

import { ExitCode, Task } from './task';

export class OutputChannelTaskManager {
    private channel: OutputChannelWrapper;

    private configurationManager: ConfigurationManager;

    private logger: ChildLogger;

    private runningTask: Task | undefined;

    private diagnostics: DiagnosticCollection;

    private diagnosticParser: DiagnosticParser;

    private statusBarItem: OutputChannelTaskStatusBarItem;

    public constructor(
        configurationManager: ConfigurationManager,
        logger: ChildLogger,
        stopCommandName: string
    ) {
        this.channel = new OutputChannelWrapper(window.createOutputChannel('Cargo'));

        this.configurationManager = configurationManager;

        this.logger = logger;

        this.diagnostics = languages.createDiagnosticCollection('rust');

        this.diagnosticParser = new DiagnosticParser();

        this.statusBarItem = new OutputChannelTaskStatusBarItem(stopCommandName);
    }

    public async startTask(
        command: string,
        args: string[],
        cwd: string,
        parseOutput: boolean
    ): Promise<void> {
        const cargoCwd = this.configurationManager.getCargoCwd();

        /**
         * Prepends the manifest path to arguments
         * if the command should be executed in a directory
         * which differs from the directory containing Cargo.toml.
         */
        function prependArgsWithManifestPathIfRequired(): void {
            if (cargoCwd === undefined || cargoCwd === cwd) {
                return;
            }

            const manifestPath = join(cwd, 'Cargo.toml');

            args = ['--manifest-path', manifestPath].concat(args);
        }

        function prependArgsWithMessageFormatIfRequired(): void {
            if (!parseOutput) {
                return;
            }

            // Prepend arguments with arguments making cargo print output in JSON.
            switch (command) {
                case 'build':
                case 'check':
                case 'clippy':
                case 'test':
                case 'run':
                    args = ['--message-format', 'json'].concat(args);
                    break;
            }
        }

        prependArgsWithMessageFormatIfRequired();

        prependArgsWithManifestPathIfRequired();

        // Prepend arguments with a command.
        args = [command].concat(args);

        // Change cwd if the user specified custom cwd.
        if (cargoCwd !== undefined) {
            cwd = cargoCwd;
        }

        this.runningTask = new Task(
            this.configurationManager,
            this.logger.createChildLogger('Task: '),
            args,
            cwd
        );

        this.runningTask.setStarted(() => {
            this.channel.clear();
            this.channel.append(`Working directory: ${cwd}\n`);
            this.channel.append(`Started cargo ${args.join(' ')}\n\n`);

            this.diagnostics.clear();
        });

        this.runningTask.setLineReceivedInStdout(line => {
            if (parseOutput && line.startsWith('{')) {
                const fileDiagnostics = this.diagnosticParser.parseLine(line);

                for (const fileDiagnostic of fileDiagnostics) {
                    fileDiagnostic.filePath = normalizeDiagnosticPath(fileDiagnostic.filePath, cwd);
                    addUniqueDiagnostic(fileDiagnostic, this.diagnostics);
                }
            } else {
                this.channel.append(`${line}\n`);
            }
        });

        this.runningTask.setLineReceivedInStderr(line => {
            this.channel.append(`${line}\n`);
        });

        if (this.configurationManager.shouldShowRunningCargoTaskOutputChannel()) {
            this.channel.show();
        }

        this.statusBarItem.show();

        let exitCode: ExitCode;

        try {
            exitCode = await this.runningTask.execute();
        } catch (error) {
            this.statusBarItem.hide();

            this.runningTask = undefined;

            // No error means the task has been interrupted
            if (error && error.message === 'ENOENT') {
                const message = 'The "cargo" command is not available. Make sure it is installed.';
                window.showInformationMessage(message);
            }

            return;
        }

        this.statusBarItem.hide();

        this.runningTask = undefined;

        this.channel.append(`\nCompleted with code ${exitCode}\n`);
    }

    public hasRunningTask(): boolean {
        return this.runningTask !== undefined;
    }

    public async stopRunningTask(): Promise<void> {
        if (this.runningTask !== undefined) {
            await this.runningTask.kill();
        }
    }
}
