FROM node:22-alpine

WORKDIR /app
COPY mock-llm.js .

ENV PORT=8090
ENV MODEL=docker-test
EXPOSE 8090

CMD ["node", "mock-llm.js"]
