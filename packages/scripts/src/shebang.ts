// A source with its leading shebang line blanked, since Bun.Transpiler#scanImports throws on one ("Unexpected #!/usr/bin/env bun", Bun 1.4.3 and 1.4.4).
export const withoutShebang = (text: string): string => text.replace(/^#!.*/, "")
