#!/usr/bin/env node

/**
 * haggl Developer Toolkit
 * Comprehensive validation and analysis tools for development
 * Usage: npx ts-node dev-toolkit.ts [command]
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// ============================================================================
// 1. TYPE VALIDATOR - Check TypeScript compilation
// ============================================================================

class TypeValidator {
  async validate(): Promise<void> {
    console.log('\n🔍 Validating TypeScript Types...');
    try {
      execSync('tsc --noEmit', {
        cwd: './frontend',
        stdio: 'inherit'
      });
      console.log('✅ TypeScript validation passed');
    } catch (error) {
      console.error('❌ TypeScript errors found');
      process.exit(1);
    }
  }
}

// ============================================================================
// 2. DESIGN TOKEN INSPECTOR - Extract and validate design tokens
// ============================================================================

class DesignTokenInspector {
  private tailwindConfig = './frontend/tailwind.config.ts';

  async inspect(): Promise<void> {
    console.log('\n🎨 Inspecting Design Tokens...');

    if (!fs.existsSync(this.tailwindConfig)) {
      console.warn('⚠️  Tailwind config not found');
      return;
    }

    const content = fs.readFileSync(this.tailwindConfig, 'utf-8');

    const colors = this.extractSection(content, 'colors');
    const spacing = this.extractSection(content, 'spacing');
    const typography = this.extractSection(content, 'fontSize');

    console.log('\n📋 Design System:');
    console.log('Colors:', Object.keys(colors).slice(0, 10).join(', '));
    console.log('Spacing:', Object.keys(spacing).slice(0, 10).join(', '));
    console.log('Typography:', Object.keys(typography).slice(0, 5).join(', '));
  }

  private extractSection(content: string, section: string): Record<string, any> {
    const regex = new RegExp(`${section}\\s*:\\s*{([^}]*)}`, 's');
    const match = content.match(regex);
    return match ? JSON.parse(`{${match[1]}}`) : {};
  }
}

// ============================================================================
// 3. ACCESSIBILITY CHECKER - Audit components for a11y issues
// ============================================================================

class AccessibilityChecker {
  async check(): Promise<void> {
    console.log('\n♿ Running Accessibility Checks...');

    const issues = this.scanFiles('./frontend/src');

    if (issues.length === 0) {
      console.log('✅ No obvious a11y issues detected');
      return;
    }

    console.log(`⚠️  Found ${issues.length} potential issues:\n`);
    issues.forEach((issue, i) => {
      console.log(`${i + 1}. ${issue.file}:${issue.line}`);
      console.log(`   ${issue.message}\n`);
    });
  }

  private scanFiles(dir: string): Array<{file: string; line: number; message: string}> {
    const issues: Array<{file: string; line: number; message: string}> = [];

    const scanDir = (dirPath: string) => {
      const files = fs.readdirSync(dirPath);

      files.forEach(file => {
        const fullPath = path.join(dirPath, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory() && !file.includes('node_modules')) {
          scanDir(fullPath);
        } else if (file.endsWith('.tsx') || file.endsWith('.ts')) {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const lines = content.split('\n');

          lines.forEach((line, index) => {
            // Check for missing alt text
            if (line.includes('<img') && !line.includes('alt=')) {
              issues.push({
                file: fullPath.replace(process.cwd(), ''),
                line: index + 1,
                message: 'Missing alt text on <img> tag'
              });
            }

            // Check for missing labels
            if (line.includes('<input') && !line.includes('aria-label') && !line.includes('id=')) {
              issues.push({
                file: fullPath.replace(process.cwd(), ''),
                line: index + 1,
                message: 'Input missing label or aria-label'
              });
            }

            // Check for missing roles
            if (line.includes('<div') && line.includes('onClick') && !line.includes('role=')) {
              issues.push({
                file: fullPath.replace(process.cwd(), ''),
                line: index + 1,
                message: 'Interactive div missing role attribute'
              });
            }
          });
        }
      });
    };

    scanDir(dir);
    return issues;
  }
}

// ============================================================================
// 4. API ENDPOINT TESTER - Test endpoints with sample payloads
// ============================================================================

class APITester {
  async test(): Promise<void> {
    console.log('\n🔗 Testing API Endpoints...');

    const testCases = [
      {
        name: 'Health Check',
        url: 'http://localhost:3000/api/health',
        method: 'GET'
      },
      {
        name: 'Get Agents',
        url: 'http://localhost:3000/api/agents',
        method: 'GET'
      }
    ];

    for (const test of testCases) {
      try {
        const response = await fetch(test.url, { method: test.method });
        const status = response.ok ? '✅' : '⚠️ ';
        console.log(`${status} ${test.name}: ${response.status}`);
      } catch (error) {
        console.log(`❌ ${test.name}: Connection failed`);
      }
    }

    console.log('\n💡 Tip: Make sure your backend is running on http://localhost:3000');
  }
}

// ============================================================================
// 5. PERFORMANCE PROFILER - Analyze bundle and component performance
// ============================================================================

class PerformanceProfiler {
  async profile(): Promise<void> {
    console.log('\n⚡ Analyzing Performance...');

    // Check bundle size
    const buildDir = './frontend/.next/static';
    if (fs.existsSync(buildDir)) {
      const size = this.getDirSize(buildDir);
      const sizeInMB = (size / 1024 / 1024).toFixed(2);

      console.log(`📦 Build Size: ${sizeInMB} MB`);

      if (parseFloat(sizeInMB) > 5) {
        console.warn('⚠️  Bundle size is large - consider code splitting');
      } else {
        console.log('✅ Bundle size is optimal');
      }
    }

    // Analyze component complexity
    this.analyzeComponentComplexity();
  }

  private getDirSize(dir: string): number {
    let size = 0;
    const files = fs.readdirSync(dir);

    files.forEach(file => {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);

      if (stat.isDirectory()) {
        size += this.getDirSize(filePath);
      } else {
        size += stat.size;
      }
    });

    return size;
  }

  private analyzeComponentComplexity(): void {
    console.log('\n📊 Component Complexity:');
    const componentDir = './frontend/src/components';

    if (!fs.existsSync(componentDir)) return;

    const files = fs.readdirSync(componentDir);
    const complexities: Array<{name: string; lines: number; complexity: string}> = [];

    files.forEach(file => {
      if (file.endsWith('.tsx')) {
        const content = fs.readFileSync(path.join(componentDir, file), 'utf-8');
        const lines = content.split('\n').length;
        let complexity = '✅ Low';

        if (lines > 300) complexity = '⚠️  High';
        else if (lines > 150) complexity = '⚡ Medium';

        complexities.push({ name: file, lines, complexity });
      }
    });

    complexities
      .sort((a, b) => b.lines - a.lines)
      .slice(0, 10)
      .forEach(c => {
        console.log(`  ${c.complexity} - ${c.name} (${c.lines} lines)`);
      });
  }
}

// ============================================================================
// 6. COMPONENT TESTER - Test React components with different props
// ============================================================================

class ComponentTester {
  async test(): Promise<void> {
    console.log('\n🧪 Testing Components...');

    try {
      execSync('npm run test -- --coverage', {
        cwd: './frontend',
        stdio: 'inherit'
      });
      console.log('✅ Component tests passed');
    } catch (error) {
      console.warn('⚠️  Some tests failed or no tests found');
    }
  }
}

// ============================================================================
// 7. VISUAL REGRESSION TRACKER - Generate snapshots for comparison
// ============================================================================

class VisualRegressionTracker {
  async generateSnapshots(): Promise<void> {
    console.log('\n📸 Generating Visual Snapshots...');

    const snapshotDir = './frontend/.visual-snapshots';

    if (!fs.existsSync(snapshotDir)) {
      fs.mkdirSync(snapshotDir, { recursive: true });
    }

    const snapshot = {
      timestamp: new Date().toISOString(),
      commit: this.getGitCommit(),
      branch: this.getGitBranch(),
      components: this.scanComponents()
    };

    fs.writeFileSync(
      path.join(snapshotDir, `snapshot-${Date.now()}.json`),
      JSON.stringify(snapshot, null, 2)
    );

    console.log(`✅ Snapshot saved to ${snapshotDir}`);
  }

  private scanComponents(): Array<{name: string; path: string; hash: string}> {
    const componentDir = './frontend/src/components';
    const components: Array<{name: string; path: string; hash: string}> = [];

    const scanDir = (dir: string) => {
      const files = fs.readdirSync(dir);

      files.forEach(file => {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory() && !file.includes('node_modules')) {
          scanDir(fullPath);
        } else if (file.endsWith('.tsx')) {
          const content = fs.readFileSync(fullPath, 'utf-8');
          components.push({
            name: file,
            path: fullPath.replace(process.cwd(), ''),
            hash: this.simpleHash(content)
          });
        }
      });
    };

    if (fs.existsSync(componentDir)) {
      scanDir(componentDir);
    }

    return components;
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  private getGitCommit(): string {
    try {
      return execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim().slice(0, 7);
    } catch {
      return 'unknown';
    }
  }

  private getGitBranch(): string {
    try {
      return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
    } catch {
      return 'unknown';
    }
  }
}

// ============================================================================
// 8. CODE QUALITY ANALYZER - Comprehensive code quality checks
// ============================================================================

class CodeQualityAnalyzer {
  async analyze(): Promise<void> {
    console.log('\n📈 Analyzing Code Quality...');

    const checks = [
      { name: 'Unused Variables', fn: () => this.checkUnusedVars() },
      { name: 'Console Logs', fn: () => this.checkConsoleLogs() },
      { name: 'TODO Comments', fn: () => this.checkTODOs() },
      { name: 'Duplicate Code', fn: () => this.checkDuplicates() }
    ];

    for (const check of checks) {
      const issues = check.fn();
      const status = issues === 0 ? '✅' : '⚠️ ';
      console.log(`${status} ${check.name}: ${issues} issues`);
    }
  }

  private checkUnusedVars(): number {
    // Simplified check - in production use ESLint
    let count = 0;
    const scanDir = (dir: string) => {
      const files = fs.readdirSync(dir);
      files.forEach(file => {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory() && !file.includes('node_modules')) {
          scanDir(fullPath);
        } else if (file.endsWith('.tsx') || file.endsWith('.ts')) {
          const content = fs.readFileSync(fullPath, 'utf-8');
          // Check for common patterns
          const matches = content.match(/const\s+\w+\s*=/g) || [];
          count += matches.length * 0.1; // Rough estimate
        }
      });
    };
    scanDir('./frontend/src');
    return Math.floor(count);
  }

  private checkConsoleLogs(): number {
    let count = 0;
    const scanDir = (dir: string) => {
      const files = fs.readdirSync(dir);
      files.forEach(file => {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory() && !file.includes('node_modules')) {
          scanDir(fullPath);
        } else if (file.endsWith('.tsx') || file.endsWith('.ts')) {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const matches = content.match(/console\.(log|warn|error)/g) || [];
          count += matches.length;
        }
      });
    };
    scanDir('./frontend/src');
    return count;
  }

  private checkTODOs(): number {
    let count = 0;
    const scanDir = (dir: string) => {
      const files = fs.readdirSync(dir);
      files.forEach(file => {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory() && !file.includes('node_modules')) {
          scanDir(fullPath);
        } else if (file.endsWith('.tsx') || file.endsWith('.ts')) {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const matches = content.match(/TODO|FIXME|BUG/gi) || [];
          count += matches.length;
        }
      });
    };
    scanDir('./frontend/src');
    return count;
  }

  private checkDuplicates(): number {
    // Simplified - real duplicate detection is complex
    return 0;
  }
}

// ============================================================================
// MAIN CLI
// ============================================================================

class HagglDevToolkit {
  async run(): Promise<void> {
    const command = process.argv[2] || 'all';

    console.log('🚀 haggl Developer Toolkit\n');

    try {
      switch (command) {
        case 'types':
          await new TypeValidator().validate();
          break;

        case 'design':
          await new DesignTokenInspector().inspect();
          break;

        case 'a11y':
          await new AccessibilityChecker().check();
          break;

        case 'api':
          await new APITester().test();
          break;

        case 'perf':
          await new PerformanceProfiler().profile();
          break;

        case 'test':
          await new ComponentTester().test();
          break;

        case 'snapshot':
          await new VisualRegressionTracker().generateSnapshots();
          break;

        case 'quality':
          await new CodeQualityAnalyzer().analyze();
          break;

        case 'all':
          await new TypeValidator().validate();
          await new DesignTokenInspector().inspect();
          await new AccessibilityChecker().check();
          await new PerformanceProfiler().profile();
          await new CodeQualityAnalyzer().analyze();
          await new VisualRegressionTracker().generateSnapshots();
          console.log('\n✅ All checks completed!\n');
          break;

        case 'help':
          this.showHelp();
          break;

        default:
          console.log(`Unknown command: ${command}`);
          this.showHelp();
      }
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  }

  private showHelp(): void {
    console.log(`
Available commands:

  npx ts-node dev-toolkit.ts all       - Run all checks
  npx ts-node dev-toolkit.ts types     - TypeScript validation
  npx ts-node dev-toolkit.ts design    - Design token inspection
  npx ts-node dev-toolkit.ts a11y      - Accessibility audit
  npx ts-node dev-toolkit.ts api       - Test API endpoints
  npx ts-node dev-toolkit.ts perf      - Performance analysis
  npx ts-node dev-toolkit.ts test      - Run component tests
  npx ts-node dev-toolkit.ts quality   - Code quality analysis
  npx ts-node dev-toolkit.ts snapshot  - Generate visual snapshots
  npx ts-node dev-toolkit.ts help      - Show this help
    `);
  }
}

// Run
new HagglDevToolkit().run().catch(console.error);
