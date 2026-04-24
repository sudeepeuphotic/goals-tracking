# API Methods (GET / POST / PUT / DELETE)

Base path: `/api`

## Auth

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/forgot-password`
- `POST /auth/reset-password`
- `POST /auth/logout`
- `GET /auth/me`
- `GET /auth/roles`
- `POST /auth/refresh`

## Users

- `GET /users`
- `GET /users/manageable`
- `POST /users`
- `PUT /users/{user_id}`

## Focus Cycles

- `GET /cycles`
- `POST /cycles`
- `PUT /cycles/{cycle_id}`

## Objectives

- `GET /objectives`
- `GET /objectives/{objective_id}`
- `POST /objectives`
- `PUT /objectives/{objective_id}`

## Plans

- `GET /plans`
- `POST /plans`

## Tasks

- `POST /plans/{plan_id}/tasks`
- `PUT /plans/{plan_id}/tasks/{task_id}`
- `DELETE /plans/{plan_id}/tasks/{task_id}`

## Weekly Updates

- `GET /updates`
- `POST /updates`

## Reflections

- `GET /reflections/individual`
- `POST /reflections/individual`
- `GET /reflections/dri`
- `POST /reflections/dri`

## Feedback

- `GET /feedback`
- `GET /feedback/summary`
- `GET /feedback/my-dri-view`
- `POST /feedback`

## Manager Review

- `GET /manager-review`
- `POST /manager-review`

## Health

- `GET /`
