@Library('pipeline') _

def version = '20.3000'

node ('controls') {
    checkout_pipeline("20.3000/pea/fix_change_stand3")
    run_branch = load '/home/sbis/jenkins_pipeline/platforma/branch/run_branch'
    run_branch.execute('builder', version)
}