#!/bin/sh
set -eu

case "${APP_PROFILE:-dev}" in
  dev|test|prod) ;;
  *)
    echo "APP_PROFILE 只能是 dev、test 或 prod" >&2
    exit 1
    ;;
esac

cp "/opt/app-config/application-${APP_PROFILE:-dev}.xml" /tmp/application.xml
