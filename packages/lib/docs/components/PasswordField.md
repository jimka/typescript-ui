# PasswordField

[`PasswordField`](/api/component/input/classes/PasswordField) is a masked text input rendering an `<input type="password">` element. It behaves like [`TextField`](/components/TextField) — value is kept in sync via `input` events — but the browser obscures the displayed characters.

## Usage

```typescript
import { PasswordField } from '@jimka/typescript-ui/component/input';
const password = PasswordField();
password.setPreferredSize({ width: 240, height: 28 });

panel.addComponent(password);
// later:
const value = password.getText();
```

## Notes

- Use over a plain `TextField` whenever the value is sensitive — the browser will skip autocomplete suggestions for password inputs and respect platform password-manager hooks.
- Defaults `autocomplete="current-password"` and `name="password"` for browser credential managers. Pass `{ newPassword: true }` on a signup / change-password field to seed `autocomplete="new-password"` instead, so the browser offers a generated password rather than autofilling the old one. Any caller-supplied `autoComplete` / `name` wins over the default.
- For password validation rules (length, complexity), wire a [`FieldDecorator`](/api/validation/classes/FieldDecorator) via the [validation pipeline](/data/binding).

## See also

- [API: PasswordField](/api/component/input/classes/PasswordField)
- [`TextField`](/components/TextField)
- [`UsernameField`](/components/UsernameField)
