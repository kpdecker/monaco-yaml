import {
  editor,
  IDisposable,
  IMarkdownString,
  IRange,
  languages,
  MarkerSeverity,
  Position,
  Range,
  Uri,
} from 'monaco-editor/esm/vs/editor/editor.api';
import * as ls from 'vscode-languageserver-types';
import { CustomFormatterOptions } from 'yaml-language-server';

import { LanguageServiceDefaultsImpl } from './monaco.contribution';
import { YAMLWorker } from './yamlWorker';

export type WorkerAccessor = (...more: Uri[]) => PromiseLike<YAMLWorker>;

// --- diagnostics --- ---

function toSeverity(lsSeverity: number): MarkerSeverity {
  switch (lsSeverity) {
    case ls.DiagnosticSeverity.Error:
      return MarkerSeverity.Error;
    case ls.DiagnosticSeverity.Warning:
      return MarkerSeverity.Warning;
    case ls.DiagnosticSeverity.Information:
      return MarkerSeverity.Info;
    case ls.DiagnosticSeverity.Hint:
      return MarkerSeverity.Hint;
    default:
      return MarkerSeverity.Info;
  }
}

function toDiagnostics(resource: Uri, diag: ls.Diagnostic): editor.IMarkerData {
  const code = typeof diag.code === 'number' ? String(diag.code) : (diag.code as string);

  return {
    severity: toSeverity(diag.severity),
    startLineNumber: diag.range.start.line + 1,
    startColumn: diag.range.start.character + 1,
    endLineNumber: diag.range.end.line + 1,
    endColumn: diag.range.end.character + 1,
    message: diag.message,
    code,
    source: diag.source,
  };
}

export class DiagnosticsAdapter {
  private _disposables: IDisposable[] = [];
  private _listener: Record<string, IDisposable> = Object.create(null);

  constructor(
    private _languageId: string,
    private _worker: WorkerAccessor,
    defaults: LanguageServiceDefaultsImpl,
  ) {
    const onModelAdd = (model: editor.IModel): void => {
      const modeId = model.getModeId();
      if (modeId !== this._languageId) {
        return;
      }

      let handle: number;
      this._listener[String(toString)] = model.onDidChangeContent(() => {
        clearTimeout(handle);
        handle = setTimeout(() => this._doValidate(model.uri, modeId), 500);
      });

      this._doValidate(model.uri, modeId);
    };

    const onModelRemoved = (model: editor.IModel): void => {
      editor.setModelMarkers(model, this._languageId, []);
      const uriStr = String(model.uri);
      const listener = this._listener[uriStr];
      if (listener) {
        listener.dispose();
        delete this._listener[uriStr];
      }
    };

    this._disposables.push(
      editor.onDidCreateModel(onModelAdd),
      editor.onWillDisposeModel((model) => {
        onModelRemoved(model);
        this._resetSchema(model.uri);
      }),
      editor.onDidChangeModelLanguage((event) => {
        onModelRemoved(event.model);
        onModelAdd(event.model);
        this._resetSchema(event.model.uri);
      }),
      defaults.onDidChange(() => {
        editor.getModels().forEach((model) => {
          if (model.getModeId() === this._languageId) {
            onModelRemoved(model);
            onModelAdd(model);
          }
        });
      }),
      {
        dispose: () => {
          editor.getModels().forEach(onModelRemoved);
          for (const disposable of Object.values(this._listener)) {
            disposable.dispose();
          }
        },
      },
    );

    editor.getModels().forEach(onModelAdd);
  }

  dispose(): void {
    this._disposables.forEach((d) => d && d.dispose());
    this._disposables = [];
  }

  private _resetSchema(resource: Uri): void {
    this._worker().then((worker) => {
      worker.resetSchema(String(resource));
    });
  }

  private _doValidate(resource: Uri, languageId: string): void {
    this._worker(resource)
      .then((worker) =>
        worker.doValidation(String(resource)).then((diagnostics) => {
          const markers = diagnostics.map((d) => toDiagnostics(resource, d));
          const model = editor.getModel(resource);
          if (model.getModeId() === languageId) {
            editor.setModelMarkers(model, languageId, markers);
          }
        }),
      )
      .then(undefined, (err) => {
        console.error(err);
      });
  }
}

// --- completion ------

function fromPosition(position: Position): ls.Position {
  if (!position) {
    return;
  }
  return { character: position.column - 1, line: position.lineNumber - 1 };
}

function fromRange(range: IRange): ls.Range {
  if (!range) {
    return;
  }
  return {
    start: {
      line: range.startLineNumber - 1,
      character: range.startColumn - 1,
    },
    end: { line: range.endLineNumber - 1, character: range.endColumn - 1 },
  };
}
function toRange(range: ls.Range): Range {
  if (!range) {
    return;
  }
  return new Range(
    range.start.line + 1,
    range.start.character + 1,
    range.end.line + 1,
    range.end.character + 1,
  );
}

function toCompletionItemKind(kind: number): languages.CompletionItemKind {
  const mItemKind = languages.CompletionItemKind;

  switch (kind) {
    case ls.CompletionItemKind.Text:
      return mItemKind.Text;
    case ls.CompletionItemKind.Method:
      return mItemKind.Method;
    case ls.CompletionItemKind.Function:
      return mItemKind.Function;
    case ls.CompletionItemKind.Constructor:
      return mItemKind.Constructor;
    case ls.CompletionItemKind.Field:
      return mItemKind.Field;
    case ls.CompletionItemKind.Variable:
      return mItemKind.Variable;
    case ls.CompletionItemKind.Class:
      return mItemKind.Class;
    case ls.CompletionItemKind.Interface:
      return mItemKind.Interface;
    case ls.CompletionItemKind.Module:
      return mItemKind.Module;
    case ls.CompletionItemKind.Property:
      return mItemKind.Property;
    case ls.CompletionItemKind.Unit:
      return mItemKind.Unit;
    case ls.CompletionItemKind.Value:
      return mItemKind.Value;
    case ls.CompletionItemKind.Enum:
      return mItemKind.Enum;
    case ls.CompletionItemKind.Keyword:
      return mItemKind.Keyword;
    case ls.CompletionItemKind.Snippet:
      return mItemKind.Snippet;
    case ls.CompletionItemKind.Color:
      return mItemKind.Color;
    case ls.CompletionItemKind.File:
      return mItemKind.File;
    case ls.CompletionItemKind.Reference:
      return mItemKind.Reference;
    default:
      return mItemKind.Property;
  }
}

function toTextEdit(textEdit: ls.TextEdit): editor.ISingleEditOperation {
  if (!textEdit) {
    return;
  }
  return {
    range: toRange(textEdit.range),
    text: textEdit.newText,
  };
}

export class CompletionAdapter implements languages.CompletionItemProvider {
  triggetCharacters = [' ', ':'];

  constructor(private _worker: WorkerAccessor) {}

  provideCompletionItems(
    model: editor.IReadOnlyModel,
    position: Position,
  ): PromiseLike<languages.CompletionList> {
    const resource = model.uri;

    return this._worker(resource)
      .then((worker) => worker.doComplete(String(resource), fromPosition(position)))
      .then((info) => {
        if (!info) {
          return;
        }

        const wordInfo = model.getWordUntilPosition(position);
        const wordRange = new Range(
          position.lineNumber,
          wordInfo.startColumn,
          position.lineNumber,
          wordInfo.endColumn,
        );

        const items: languages.CompletionItem[] = info.items.map((entry) => {
          const item: languages.CompletionItem = {
            label: entry.label,
            insertText: entry.insertText || entry.label,
            sortText: entry.sortText,
            filterText: entry.filterText,
            documentation: entry.documentation,
            detail: entry.detail,
            kind: toCompletionItemKind(entry.kind),
            range: wordRange,
          };
          if (entry.textEdit) {
            item.range = toRange(
              'range' in entry.textEdit ? entry.textEdit.range : entry.textEdit.replace,
            );
            item.insertText = entry.textEdit.newText;
          }
          if (entry.additionalTextEdits) {
            item.additionalTextEdits = entry.additionalTextEdits.map(toTextEdit);
          }
          if (entry.insertTextFormat === ls.InsertTextFormat.Snippet) {
            item.insertTextRules = languages.CompletionItemInsertTextRule.InsertAsSnippet;
          }
          return item;
        });

        return {
          isIncomplete: info.isIncomplete,
          suggestions: items,
        };
      });
  }
}

function isMarkupContent(thing: unknown): thing is ls.MarkupContent {
  return thing && typeof thing === 'object' && typeof (thing as ls.MarkupContent).kind === 'string';
}

function toMarkdownString(entry: ls.MarkedString | ls.MarkupContent): IMarkdownString {
  if (typeof entry === 'string') {
    return {
      value: entry,
    };
  }
  if (isMarkupContent(entry)) {
    if (entry.kind === 'plaintext') {
      return {
        value: entry.value.replace(/[!#()*+.[\\\]_`{}-]/g, '\\$&'),
      };
    }
    return {
      value: entry.value,
    };
  }

  return { value: `\`\`\`${entry.language}\n${entry.value}\n\`\`\`\n` };
}

function toMarkedStringArray(
  contents: ls.MarkedString | ls.MarkedString[] | ls.MarkupContent,
): IMarkdownString[] {
  if (!contents) {
    return;
  }
  if (Array.isArray(contents)) {
    return contents.map(toMarkdownString);
  }
  return [toMarkdownString(contents)];
}

// --- hover ------

export class HoverAdapter implements languages.HoverProvider {
  constructor(private _worker: WorkerAccessor) {}

  provideHover(model: editor.IReadOnlyModel, position: Position): PromiseLike<languages.Hover> {
    const resource = model.uri;

    return this._worker(resource)
      .then((worker) => worker.doHover(String(resource), fromPosition(position)))
      .then((info) => {
        if (!info) {
          return;
        }
        return {
          range: toRange(info.range),
          contents: toMarkedStringArray(info.contents),
        } as languages.Hover;
      });
  }
}

// --- document symbols ------

function toSymbolKind(kind: ls.SymbolKind): languages.SymbolKind {
  const mKind = languages.SymbolKind;

  switch (kind) {
    case ls.SymbolKind.File:
      return mKind.Array;
    case ls.SymbolKind.Module:
      return mKind.Module;
    case ls.SymbolKind.Namespace:
      return mKind.Namespace;
    case ls.SymbolKind.Package:
      return mKind.Package;
    case ls.SymbolKind.Class:
      return mKind.Class;
    case ls.SymbolKind.Method:
      return mKind.Method;
    case ls.SymbolKind.Property:
      return mKind.Property;
    case ls.SymbolKind.Field:
      return mKind.Field;
    case ls.SymbolKind.Constructor:
      return mKind.Constructor;
    case ls.SymbolKind.Enum:
      return mKind.Enum;
    case ls.SymbolKind.Interface:
      return mKind.Interface;
    case ls.SymbolKind.Function:
      return mKind.Function;
    case ls.SymbolKind.Variable:
      return mKind.Variable;
    case ls.SymbolKind.Constant:
      return mKind.Constant;
    case ls.SymbolKind.String:
      return mKind.String;
    case ls.SymbolKind.Number:
      return mKind.Number;
    case ls.SymbolKind.Boolean:
      return mKind.Boolean;
    case ls.SymbolKind.Array:
      return mKind.Array;
    default:
      return mKind.Function;
  }
}

function toDocumentSymbol(item: ls.DocumentSymbol): languages.DocumentSymbol {
  return {
    detail: '',
    range: toRange(item.range),
    name: item.name,
    kind: toSymbolKind(item.kind),
    selectionRange: toRange(item.selectionRange),
    children: item.children.map((child) => toDocumentSymbol(child)),
    tags: [],
  };
}

export class DocumentSymbolAdapter implements languages.DocumentSymbolProvider {
  constructor(private _worker: WorkerAccessor) {}

  provideDocumentSymbols(model: editor.IReadOnlyModel): PromiseLike<languages.DocumentSymbol[]> {
    const resource = model.uri;

    return this._worker(resource)
      .then((worker) => worker.findDocumentSymbols(String(resource)))
      .then((items) => {
        if (!items) {
          return;
        }
        return items.map((item) => toDocumentSymbol(item));
      });
  }
}

function fromFormattingOptions(
  options: languages.FormattingOptions,
): CustomFormatterOptions & ls.FormattingOptions {
  return {
    tabSize: options.tabSize,
    insertSpaces: options.insertSpaces,
    ...options,
  };
}

export class DocumentFormattingEditProvider implements languages.DocumentFormattingEditProvider {
  constructor(private _worker: WorkerAccessor) {}

  provideDocumentFormattingEdits(
    model: editor.IReadOnlyModel,
    options: languages.FormattingOptions,
  ): PromiseLike<editor.ISingleEditOperation[]> {
    const resource = model.uri;

    return this._worker(resource).then((worker) =>
      worker.format(String(resource), null, fromFormattingOptions(options)).then((edits) => {
        if (!edits || edits.length === 0) {
          return;
        }
        return edits.map(toTextEdit);
      }),
    );
  }
}

export class DocumentRangeFormattingEditProvider
  implements languages.DocumentRangeFormattingEditProvider {
  constructor(private _worker: WorkerAccessor) {}

  provideDocumentRangeFormattingEdits(
    model: editor.IReadOnlyModel,
    range: Range,
    options: languages.FormattingOptions,
  ): PromiseLike<editor.ISingleEditOperation[]> {
    const resource = model.uri;

    return this._worker(resource).then((worker) =>
      worker
        .format(String(resource), fromRange(range), fromFormattingOptions(options))
        .then((edits) => {
          if (!edits || edits.length === 0) {
            return;
          }
          return edits.map(toTextEdit);
        }),
    );
  }
}
