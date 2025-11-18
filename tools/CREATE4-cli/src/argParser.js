function parseArgs(args, optionDefs = [], { allowPositionals = false } = {}) {
  const definitions = optionDefs.map((def) => ({
    ...def,
    flag: def.flag || def.name,
    type: def.type || 'string',
  }));
  const flagMap = new Map();
  const values = {};

  for (const def of definitions) {
    if (!def.flag) {
      throw new Error('Option definitions require a name or flag value');
    }
    if (flagMap.has(`--${def.flag}`)) {
      throw new Error(`Duplicate option definition for --${def.flag}`);
    }
    flagMap.set(`--${def.flag}`, def);
    if (def.alias) {
      flagMap.set(`-${def.alias}`, def);
    }
    if (def.type === 'boolean') {
      values[def.name] = def.default !== undefined ? def.default : false;
    } else if (def.default !== undefined) {
      values[def.name] = def.default;
    }
  }

  const positionals = [];
  let help = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') {
      positionals.push(...args.slice(i + 1));
      break;
    }
    if (arg === '-h' || arg === '--help') {
      help = true;
      continue;
    }
    if (!arg.startsWith('-') || arg === '-') {
      positionals.push(arg);
      continue;
    }

    const eqIndex = arg.indexOf('=');
    const flagName = eqIndex === -1 ? arg : arg.slice(0, eqIndex);
    const inlineValue = eqIndex === -1 ? undefined : arg.slice(eqIndex + 1);
    const def = flagMap.get(flagName);
    if (!def) {
      throw new Error(`Unknown option: ${flagName}`);
    }

    if (def.type === 'boolean') {
      if (inlineValue !== undefined && inlineValue.length > 0) {
        values[def.name] = inlineValue !== 'false';
      } else {
        values[def.name] = true;
      }
      continue;
    }

    let consumedValue = inlineValue;
    if (consumedValue === undefined) {
      consumedValue = args[++i];
      if (consumedValue === undefined) {
        throw new Error(`Option ${flagName} requires a value`);
      }
    }
    values[def.name] = consumedValue;
  }

  if (!allowPositionals && positionals.length > 0) {
    throw new Error(`Unexpected positional argument: ${positionals[0]}`);
  }

  return {
    help,
    values,
    positionals,
  };
}

module.exports = {
  parseArgs,
};
