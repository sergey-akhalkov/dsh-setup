# Spec Delta

## MODIFIED Requirements

### Requirement: Native picker registration

The plugin SHALL register the client command `/openspec-apply` through the DSH client command API and
SHALL present its choices with the client's built-in `popupSelect` shell. The plugin MUST supply only
option data and the selection handler; it MUST NOT ship its own React components, styles, icons, or
popup. This clause governs the picker's own presentation only: other client surfaces the same package
ships are governed by their own capability, and their bodies MAY be built from the shipped DSH component
library. When the client command service is unavailable the client half MUST register nothing and raise
no error.

#### Scenario: Command listed and picker opens

- **WHEN** the Web client loads the plugin and the client command service exists
- **THEN** `/openspec-apply` is listed in the slash menu and invoking it opens the built-in picker shell

#### Scenario: Inert without the client service

- **WHEN** the client command service is absent
- **THEN** the client half registers no command and no error reaches the composer

#### Scenario: Shell owns the presentation

- **WHEN** the picker renders
- **THEN** the rows, search field, keyboard navigation, empty state, error strip, and styling come from the picker shell

#### Scenario: A second surface does not change the picker

- **WHEN** the package also contributes a panel outside the composer
- **THEN** `/openspec-apply` still opens the built-in picker shell unchanged
