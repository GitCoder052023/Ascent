function patchFile(fs, target, stock, patched, alreadyMarker) {
  if (!fs.existsSync(target)) {
    return;
  }
  const source = fs.readFileSync(target, "utf8");
  if (source.includes(alreadyMarker)) {
    return;
  }
  if (!source.includes(stock)) {
    return;
  }
  fs.writeFileSync(target, source.replace(stock, patched));
}

module.exports = { patchFile };
