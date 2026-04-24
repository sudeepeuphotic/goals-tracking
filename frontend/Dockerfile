FROM node:20-alpine AS build

WORKDIR /app
ARG REACT_APP_BACKEND_URL
ARG REACT_APP_COGNITO_USER_POOL_ID
ARG REACT_APP_COGNITO_CLIENT_ID
ENV REACT_APP_BACKEND_URL=$REACT_APP_BACKEND_URL
ENV REACT_APP_COGNITO_USER_POOL_ID=$REACT_APP_COGNITO_USER_POOL_ID
ENV REACT_APP_COGNITO_CLIENT_ID=$REACT_APP_COGNITO_CLIENT_ID
COPY package.json yarn.lock* package-lock.json* ./
RUN if [ -f yarn.lock ]; then yarn install --frozen-lockfile; else npm install --legacy-peer-deps; fi
RUN if [ ! -f yarn.lock ]; then npm install --legacy-peer-deps ajv@^8 ajv-keywords@^5; fi

COPY . .
RUN if [ -f yarn.lock ]; then yarn build; else npm run build; fi

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/build /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
