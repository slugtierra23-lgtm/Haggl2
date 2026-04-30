# 🛠️ haggl Developer Toolkit

A comprehensive validation and analysis suite for haggl development. All 8 tools integrated into a single CLI.

## Installation

```bash
npm install -D ts-node typescript
```

## Usage

### Run All Checks (Recommended)
```bash
npx ts-node dev-toolkit.ts all
```

### Individual Tools

#### 1. **Type Validator** - TypeScript Compilation Check
```bash
npx ts-node dev-toolkit.ts types
```
✅ Validates all TypeScript types in the frontend  
Catches type errors before runtime

#### 2. **Design Token Inspector** - Extract Design System
```bash
npx ts-node dev-toolkit.ts design
```
✅ Inspects Tailwind config  
✅ Extracts colors, spacing, typography  
✅ Helps maintain design consistency

#### 3. **Accessibility Auditor** - a11y Compliance Check
```bash
npx ts-node dev-toolkit.ts a11y
```
✅ Checks for missing alt text on images  
✅ Detects unlabeled inputs  
✅ Finds interactive elements missing roles  
✅ Reports line numbers for easy fixing

#### 4. **API Endpoint Tester** - Test Backend Connectivity
```bash
npx ts-node dev-toolkit.ts api
```
✅ Tests health checks  
✅ Verifies endpoint availability  
✅ Requires backend running on http://localhost:3000

#### 5. **Performance Profiler** - Bundle & Component Analysis
```bash
npx ts-node dev-toolkit.ts perf
```
✅ Analyzes build size  
✅ Flags large bundles (>5MB)  
✅ Rates component complexity  
✅ Top 10 largest components

#### 6. **Component Tester** - Run Test Suite
```bash
npx ts-node dev-toolkit.ts test
```
✅ Runs Jest/Vitest tests  
✅ Generates coverage report  
✅ Validates component behavior

#### 7. **Visual Regression Tracker** - Generate Snapshots
```bash
npx ts-node dev-toolkit.ts snapshot
```
✅ Creates timestamp-stamped snapshots  
✅ Tracks component changes  
✅ Stores git commit info  
✅ Enables visual diff comparison

#### 8. **Code Quality Analyzer** - Find Issues
```bash
npx ts-node dev-toolkit.ts quality
```
✅ Detects unused variables  
✅ Finds console.log statements  
✅ Locates TODO/FIXME comments  
✅ Reports duplicate code patterns

## Integration

### Pre-Commit Hook
Add to `.husky/pre-commit`:
```bash
npx ts-node dev-toolkit.ts types && npx ts-node dev-toolkit.ts a11y
```

### CI/CD Pipeline
Add to `.github/workflows/test.yml`:
```yaml
- name: Run Dev Toolkit
  run: npx ts-node dev-toolkit.ts all
```

### VSCode Integration
Create `.vscode/tasks.json`:
```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Dev Toolkit: All Checks",
      "type": "shell",
      "command": "npx ts-node dev-toolkit.ts all",
      "problemMatcher": []
    }
  ]
}
```

## Output Examples

### ✅ All Checks Pass
```
🚀 haggl Developer Toolkit

🔍 Validating TypeScript Types...
✅ TypeScript validation passed

🎨 Inspecting Design Tokens...
📋 Design System:
Colors: slate, gray, zinc, neutral, stone, red, orange...
Spacing: 0, 1, 2, 3, 4, 5, 6, 8...
Typography: xs, sm, base, lg, xl...

♿ Running Accessibility Checks...
✅ No obvious a11y issues detected

⚡ Analyzing Performance...
📦 Build Size: 2.34 MB
✅ Bundle size is optimal

📈 Analyzing Code Quality...
✅ Unused Variables: 0 issues
✅ Console Logs: 2 issues
⚠️  TODO Comments: 5 issues
✅ Duplicate Code: 0 issues

✅ All checks completed!
```

### ⚠️ Issues Found
```
⚠️  Found 3 potential issues:

1. frontend/src/components/Button.tsx:45
   Missing alt text on <img> tag

2. frontend/src/components/Form.tsx:78
   Input missing label or aria-label

3. frontend/src/pages/dashboard.tsx:120
   Interactive div missing role attribute
```

## Tips

**For Best Results:**
- Run `all` before committing code
- Use `snapshot` after major UI changes
- Check `perf` weekly to track bundle growth
- Review `quality` output in sprint retrospectives

**Performance Target:**
- Bundle Size: < 5MB
- Component Files: < 200 lines each
- Console Logs: 0 in production code

**Accessibility Target:**
- 0 issues reported by auditor
- WCAG 2.1 Level AA compliance
- Keyboard navigation enabled

## Extending the Toolkit

Add new validators in `HagglDevToolkit` class:

```typescript
case 'custom':
  await new MyCustomValidator().validate();
  break;
```

## Requirements

- Node.js 16+
- TypeScript
- npm or yarn
- Backend running for API tests (optional)

---

**Created for haggl by Claude**  
Enhance your development workflow with automated validation
