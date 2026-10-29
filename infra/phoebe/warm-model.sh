#!/bin/sh
set -eu
printf '%s\n' '{"id":1,"op":"ping"}' | /opt/just-maple/bin/just-maple-search
