# Development Workflow Rules

## Core Principles
1. **Commit Early, Commit Often**: Make a commit after every meaningful edit in the codebase
2. **Push Regularly**: Push commits to GitHub to maintain a complete history
3. **Document Everything**: Add comments and documentation for all code changes

## Specific Rules

### 1. After Every Code Edit
- Immediately stage and commit changes with a descriptive message
- Include the purpose of the change in the commit message
- Push changes to the remote repository

### 2. Code Changes
- All edits must include proper documentation/comments
- Complex changes require additional explanation in the commit message
- Maintain consistent coding style with the existing codebase

### 3. Prompt Modifications
- When updating AI prompts, ensure they:
  - Are strictly scoped to the required task
  - Include clear negative instructions for elements that must not change
  - Maintain consistent formatting with the rest of the codebase

### 4. Quality Assurance
- Test changes thoroughly before committing
- Verify that UI components render correctly after edits
- Check for syntax errors and type consistency