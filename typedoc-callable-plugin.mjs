// Promotes callable-wrapped classes (e.g. `const Button = callable(_Button)`) from
// /api/variables/X.md back to /api/classes/X.md, restoring full API documentation.
// Without this, TypeDoc only sees the const and emits an empty stub page.

import ts from 'typescript';
import { Converter, ReflectionKind } from 'typedoc';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// convertSymbol isn't in typedoc's `exports`; reach it via a file URL to bypass the gate.
const require = createRequire(import.meta.url);
const typedocPkgPath = require.resolve('typedoc/package.json');
const symbolsUrl = pathToFileURL(
    typedocPkgPath.replace(/package\.json$/, 'dist/lib/converter/symbols.js'),
).href;
const { convertSymbol } = await import(symbolsUrl);

const pending = new Map();

export function load(app) {
    app.converter.on(Converter.EVENT_CREATE_DECLARATION, onCreateDeclaration);
    app.converter.on(Converter.EVENT_RESOLVE_BEGIN, onResolveBegin, 100);
}

function onCreateDeclaration(context, reflection) {
    if (reflection.kind !== ReflectionKind.Variable) return;

    const valueSymbol = context.project.getSymbolFromReflection(reflection);
    if (!valueSymbol) return;

    const found = findCallableTarget(context, valueSymbol, reflection.name);
    if (!found) return;

    pending.set(reflection.id, {
        ...found,
        parent: reflection.parent,
    });
}

function findCallableTarget(context, valueSymbol, publicName) {
    const valueDecl = valueSymbol.valueDeclaration;
    if (!valueDecl || !ts.isVariableDeclaration(valueDecl)) return null;

    const init = valueDecl.initializer;
    if (!init || !ts.isCallExpression(init)) return null;
    if (!ts.isIdentifier(init.expression) || init.expression.text !== 'callable') return null;
    if (init.arguments.length !== 1) return null;

    const classArg = init.arguments[0];
    const argSymbol = context.checker.getSymbolAtLocation(classArg);
    if (!argSymbol) return null;

    const innerClassSymbol = context.resolveAliasedSymbol(argSymbol);
    if (!(innerClassSymbol.flags & ts.SymbolFlags.Class)) return null;

    const publicExportAlias = findPublicExportAlias(context, valueSymbol, publicName);
    if (!publicExportAlias) return null;

    return { innerClassSymbol, publicExportAlias };
}

function findPublicExportAlias(context, valueSymbol, publicName) {
    for (const program of context.programs) {
        for (const sourceFile of program.getSourceFiles()) {
            if (sourceFile.isDeclarationFile) continue;
            if (!sourceFile.symbol) continue;
            const exports = context.checker.getExportsOfModule(sourceFile.symbol);
            const alias = exports.find(s => s.name === publicName);
            if (alias && context.resolveAliasedSymbol(alias) === valueSymbol) {
                return alias;
            }
        }
    }
    return null;
}

function onResolveBegin(context) {
    if (pending.size === 0) return;
    context.logger.info(`callable-plugin: promoting ${pending.size} callable variables to classes`);

    for (const [id, info] of pending) {
        const variableRef = context.project.getReflectionById(id);
        if (!variableRef) continue;

        const variableSymbol = context.project.getSymbolFromReflection(variableRef);

        const siblings = info.parent.children ?? [];
        const typeAliasSibling = siblings.find(c =>
            c.name === variableRef.name && c.kind === ReflectionKind.TypeAlias
        );
        const typeAliasSymbol = typeAliasSibling
            ? context.project.getSymbolFromReflection(typeAliasSibling)
            : undefined;

        context.project.removeReflection(variableRef);
        if (typeAliasSibling) context.project.removeReflection(typeAliasSibling);

        const sourceFile = info.innerClassSymbol.declarations?.[0]?.getSourceFile();
        const program = sourceFile && context.programs.find(p => p.getSourceFile(sourceFile.fileName));
        if (!program) {
            context.logger.error(
                `callable-plugin: no program owns ${info.publicExportAlias.name} source file`
            );
            continue;
        }

        const scoped = context.withScope(info.parent);
        scoped.setActiveProgram(program);
        try {
            convertSymbol(scoped, info.innerClassSymbol, info.publicExportAlias);
        } catch (err) {
            context.logger.error(
                `callable-plugin: failed to promote ${info.publicExportAlias.name}: ${err.message}`
            );
            continue;
        } finally {
            scoped.setActiveProgram(undefined);
        }

        const newClass = context.project.getReflectionFromSymbol(info.innerClassSymbol);
        if (newClass) {
            if (variableSymbol) context.project.registerReflection(newClass, variableSymbol);
            if (typeAliasSymbol) context.project.registerReflection(newClass, typeAliasSymbol);
        }
    }

    pending.clear();
}
