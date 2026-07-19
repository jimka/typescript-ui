# UsernameField

[`UsernameField`](/api/component/input/classes/UsernameField) is a username / login-identifier text input — a `TextField` preset that defaults `autocomplete="username"` and `name="username"` for browser credential managers.

## Usage

```typescript
import { UsernameField, PasswordField } from '@jimka/typescript-ui/component/input';
const username = UsernameField();
username.setPreferredSize(240, 28);

panel.addComponent(username);
panel.addComponent(PasswordField());
// later:
const value = username.getText();
```

## Notes

- Pass `{ email: true }` to seed `autocomplete="email"` instead of `autocomplete="username"`, for logins keyed off an email address rather than a separate username.
- `type` is always `"text"` (not `type="email"`), so the field never triggers native email validation on a login identifier.
- Any caller-supplied `autoComplete` / `name` wins over the default, so a non-credential field can opt out with `UsernameField({ autoComplete: "off" })`.

## See also

- [API: UsernameField](/api/component/input/classes/UsernameField)
- [`TextField`](/components/TextField)
- [`PasswordField`](/components/PasswordField)
