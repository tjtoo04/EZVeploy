/**
 * Where each user's Docker daemon lives.
 * - root uses the system daemon socket.
 * - tenants run rootless Docker: unix socket under /run/user/<uid>/.
 */
export function socketPathFor(user) {
 return user.root
  ? "/var/run/docker.sock"
  : `/run/user/${user.uid}/docker.sock`;
}

/** argv prefix for addressing one user's daemon. */
export function dockerHostArgv(user, dockerBin) {
 return [dockerBin, "--host", socketPathFor(user)];
}
