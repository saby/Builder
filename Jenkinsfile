@Library('pipeline') _

def version = '21.3000'

node ('controls') {
    checkout_pipeline("21.3000/bugfix/bls/not_run_saby_builder")
    run_branch = load '/home/sbis/jenkins_pipeline/platforma/branch/run_branch'
    run_branch.execute('builder', version)
}