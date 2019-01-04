const test = require('tape')
const Sync = require('./sync.js')
const {ObjectSyncProtocol, SET_PROPERTY, CREATE_OBJECT, CREATE_PROPERTY} = Sync

/*
 create object A as child of root with property x = 100
  */
test('basic',t => {
    const sync = new ObjectSyncProtocol()
    const root = sync.createObject()
    sync.createProperty(root,'id','root')


    const A = sync.createObject()
    sync.createProperty(A,'id','A')
    sync.createProperty(A,'x',100)

    sync.createProperty(root,'children',[])
    sync.setProperty(root,'children',[A])


    const graph1 = sync.dumpGraph()
    t.deepEquals(graph1, {
        root: {id: 'root', children: [A]},
        A: {id: 'A',x:100},
    })
    t.end()
})

/*
 * create object A with property x = 100
 * set x to 200
 * dump the history. shows create object, create prop, set prop
 */
test('history', t => {
    const sync = new ObjectSyncProtocol()
    const history = []
    sync.onChange((e)=>{
        const obj = { type:e.type}
        if(e.type === CREATE_PROPERTY || e.type === SET_PROPERTY) {
            obj.name = e.name
            obj.value = e.value
        }
        history.push(obj)
    })
    const A = sync.createObject()
    sync.createProperty(A,'id','A')
    sync.createProperty(A,'x',100)
    sync.setProperty(A,'x',200)

    t.deepEquals(history,[
        { type:CREATE_OBJECT},
        { type:CREATE_PROPERTY,name:'id',value:'A'},
        { type:CREATE_PROPERTY,name:'x',value:100},
        { type:SET_PROPERTY,name:'x',value:200},
    ])

    t.end()
})

/*
user A create object R with R.x = 100
sync
user B sets R.x to 200
sync
user A can see R.x = 200
*/
test('sync', t => {
    const A = new ObjectSyncProtocol()
    const B = new ObjectSyncProtocol()

    function sync(X,Y) {
        X.onChange(e => {
            // console.log("client changed",e)
            if(e.type === CREATE_OBJECT) Y.createObject(e.id)
            if(e.type === CREATE_PROPERTY) Y.createProperty(e.object, e.name, e.value)
            if(e.type === SET_PROPERTY) Y.setProperty(e.object, e.name, e.value)
        })
    }
    sync(A,B)
    sync(B,A)

    const aR1 = A.createObject()
    A.createProperty(aR1,'id','R')
    A.createProperty(aR1,'x',100)

    t.deepEquals(A.dumpGraph(), { R: {id: 'R',x:100} })
    t.deepEquals(B.dumpGraph(), { R: {id: 'R',x:100} })


    const bR1 = B.getObjectByProperty('id','R')
    B.setProperty(bR1,'x',200)

    t.deepEquals(A.dumpGraph(), { R: {id:'R',x:200}})
    t.deepEquals(B.dumpGraph(), { R: {id:'R',x:200}})


    const aR2 = A.getObjectByProperty('id','R')
    t.equal(A.getPropertyValue(aR2,'x'),200)
    t.end()
})

/*
create object R with R.x = 100
set R.x = 200
check undo queue
undo it
check
redo it
check

*/

test('undo',t => {
    class UndoQueue {
        constructor(graph) {
            this.graph = graph
            this.history = []
            this.current = 0
            graph.onChange((e)=>{
                // console.log('graph changed',e)
                this.current++
                if(e.type === CREATE_OBJECT) {
                    this.history.push({
                        type:e.type,
                        object:e.object
                    })
                    return
                }
                if(e.type === CREATE_PROPERTY) {
                    this.history.push({
                        type:e.type,
                        object:e.object,
                        name:e.name,
                        value:e.value
                    })
                    return
                }
                if(e.type === SET_PROPERTY) {
                    console.log("looking for last",this.findLastPropertyValue(e.object, e.name))
                    this.history.push({
                        id:Math.random(),
                        type: e.type,
                        object: e.object,
                        name: e.name,
                        oldValue: this.findLastPropertyValue(e.object, e.name),
                        newValue: e.value
                    })
                }
            })
        }
        undo() {
            this.current--
            const last = this.history[this.current]
            // console.log("last is",last)
            if(last.type === SET_PROPERTY) {
                // console.log("undoing")
                this.graph.setProperty(last.object,last.name, last.oldValue)
                return
            }
            throw new Error(`undo for type not supported: ${last.type}`)
        }
        redo() {
            const last = this.history[this.current]
            // console.log("last is",last)
            if(last.type === SET_PROPERTY) {
                // console.log("redoing")
                this.graph.setProperty(last.object,last.name,last.oldValue)
                return
            }
            throw new Error(`redo for type not supported: ${last.type}`)
        }
        findLastPropertyValue(objid,propname) {
            for(let i=this.history.length-1; i>=0; i--) {
                const h = this.history[i]
                if(h.object === objid && h.name === propname) {
                    if(h.type === SET_PROPERTY) return h.newValue
                    if(h.type === CREATE_PROPERTY) return h.value
                }
            }
            console.error(`could not find history entry for property ${objid}:${propname}`)
            return null
        }
        dump() {
            return this.history.map(h=>{
                const entry = {
                    type:h.type
                }
                if(h.type === CREATE_PROPERTY) {
                    entry.name = h.name
                    entry.value = h.value
                }
                if(h.type === SET_PROPERTY) {
                    entry.name = h.name
                    entry.oldValue = h.oldValue
                    entry.newValue = h.newValue
                }
                return entry
            })
        }
    }

    const sync = new ObjectSyncProtocol()
    const undoqueue = new UndoQueue(sync)

    const R = sync.createObject()
    sync.createProperty(R,'x',100)
    sync.setProperty(R,'x',200)
    t.deepEquals(undoqueue.dump(),[
        {type:CREATE_OBJECT},
        {type:CREATE_PROPERTY,name:'x',value:100},
        {type:SET_PROPERTY,name:'x',oldValue:100, newValue:200},
    ])

    t.equals(sync.getPropertyValue(R,'x'),200)

    undoqueue.undo()
    t.equals(sync.getPropertyValue(R,'x'),100)
    undoqueue.redo()
    t.equals(sync.getPropertyValue(R,'x'),200)
    t.end()
})


/*
 * tree B follows changes to tree A. Add, set, delete some objects. Confirm tree B is still valid.
 */

test('jsonview',t => {
    class JSONView {
        constructor(graph) {
            this.graph = graph
            graph.onChange((e)=>{
                // console.log("graph changed",e)
            })
        }

        getJSONViewById(id) {
            // console.log("getting the view for",id)
            const root = this.graph.getObjectByProperty('id',id)
            // console.log("found the root",root)
            return this.getJSONViewByRealId(root)
        }
        getJSONViewByRealId(id) {
            const props = this.graph.getPropertiesForObject(id)
            // console.log("got the properties",props)
            const rootObj = {}
            props.forEach(name => {
                rootObj[name] = this.graph.getPropertyValue(id,name)
                if(name === 'children') {
                    rootObj.children = rootObj[name].map((objid)=>{
                        // console.log("expanding child",objid)
                        return this.getJSONViewByRealId(objid)
                    })
                }
            })

            return rootObj
        }
    }

    const sync = new ObjectSyncProtocol()
    const jsonview = new JSONView(sync)

    const O1 = sync.createObject()
    sync.createProperty(O1,'id','O1')
    sync.createProperty(O1,'x',100)
    sync.setProperty(O1,'x',200)

    const root = sync.createObject()
    sync.createProperty(root,'id','ROOT')
    sync.createProperty(root,'x',300)
    sync.createProperty(root,'children',[O1])



    t.deepEquals(
        jsonview.getJSONViewById('ROOT'),
        {
            id:'ROOT',
            x:300,
            children:[
                {
                    id:'O1',
                    x:200
                }
            ]
        }
    )

    const O2 = sync.createObject()
    sync.createProperty(O2,'id','O2')
    sync.createProperty(O2,'x',400)
    sync.setProperty(root,'children',[O1,O2])



    t.deepEquals(
        jsonview.getJSONViewById('ROOT'),
        {
            id:'ROOT',
            x:300,
            children:[
                {
                    id:'O1',
                    x:200
                },
                {
                    id:'O2',
                    x:400
                }
            ]
        }
    )

    sync.deleteObject(O1)
    sync.setProperty(root,'children',[O2])

    t.deepEquals(
        jsonview.getJSONViewById('ROOT'),
        {
            id:'ROOT',
            x:300,
            children:[
                {
                    id:'O2',
                    x:400
                }
            ]
        }
    )

    t.end()
})


/*
* coalesce a set of changes into a single ‘transaction’
* which can then be submitted as a batch
 */

test('coalesce',t => {
    class Throttle {
        constructor(graph) {
            this.graph = graph
            this.paused = false
            this.buffer = []
        }
        createProperty(objid, propname, value) {
            if(!this.paused) {
                return this.graph.createProperty(objid,propname,value)
            }
        }
        createObject() {
            if(!this.paused) {
                return this.graph.createObject()
            }
        }
        setProperty(objid, propname, propvalue) {
            if(!this.paused) {
                return this.graph.setProperty(objid,propname,propvalue)
            }
            this.buffer.push({type:SET_PROPERTY,object:objid, name:propname, value:propvalue})
        }

        pause() {
            this.paused = true
        }

        unpause() {
            // console.log("unpausing. buffer is", this.buffer)
            const b = {}
            this.buffer.forEach(e => {
                if(e.type === SET_PROPERTY) {
                    if(!b[e.object]) b[e.object] = {}
                    b[e.object][e.name] = e.value
                }
            })
            // console.log("condensed",b)
            Object.keys(b).forEach((okey) =>{
                // console.log("obj",okey)
                Object.keys(b[okey]).forEach(name=>{
                    // console.log("name",name,b[okey][name])
                    this.graph.setProperty(okey,name,b[okey][name])
                })
            })
            this.paused = false
            this.buffer = []
        }
    }

    const sync = new ObjectSyncProtocol()
    const history = []
    sync.onChange((e)=>{
        history.push(e)
    })

    const throttle = new Throttle(sync)

    const A = throttle.createObject()
    throttle.createProperty(A,'x',100)
    throttle.pause()
    throttle.setProperty(A,'x',101)
    throttle.setProperty(A,'x',102)
    throttle.setProperty(A,'x',103)
    throttle.unpause()

    t.deepEquals(history,
        [
            {type:CREATE_OBJECT, id:A},
            {type:CREATE_PROPERTY,object:A, name:'x',value:100},
            {type:SET_PROPERTY,object:A, name:'x',value:103}
        ]
    )
    t.end()
})



/*
 * record a sequence of changes while disconnected.
 * Reconnect and sync without conflicts.
 * Confirm that the final tree snapshot is correct.
 */

// test('disconnected',t => {
//     const Server = Sync.createSync()
//     const A = Sync.createSync()
//     const B = Sync.createSync()
//
//     Server.listen(A)
//     Server.listen(B)
//     A.listen(Server)
//     B.listen(Server)
//
//     const R = A.createObject()
//     A.createProperty(R,'x',1)
//
//     // all sides have the same value
//     t.equal(A.getPropertyValue(A.getObjectById(A.getId(R)),'x'),1)
//     t.equal(Server.getPropertyValue(Server.getObjectById(A.getId(R)),'x'),1)
//     t.equal(B.getPropertyValue(B.getObjectById(A.getId(R)),'x'),1)
//
//     //disconnect A
//     A.disconnect()
//     A.createProperty(R,'y',20)
//     A.setProperty(R,'x',2)
//
//     // sides have different values
//     t.equal(A.getPropertyValue(A.getObjectById(A.getId(R)),'x'),2)
//     t.equal(Server.getPropertyValue(Server.getObjectById(A.getId(R)),'x'),1)
//     t.equal(B.getPropertyValue(B.getObjectById(A.getId(R)),'x'),1)
//
//     t.equal(A.getPropertyValue(A.getObjectById(A.getId(R)),'y'),20)
//     t.equal(Server.hasPropertyValue(Server.getObjectById(A.getId(R)),'y'),false)
//     t.equal(B.hasPropertyValue(Server.getObjectById(A.getId(R)),'y'),false)
//
//     //dump the local storage
//
//     //
//     A.connect()
//
//     // all sides have the same value
//     t.equal(A.getPropertyValue(A.getObjectById(A.getId(R)),'x'),2)
//     t.equal(Server.getPropertyValue(Server.getObjectById(A.getId(R)),'x'),2)
//     t.equal(B.getPropertyValue(B.getObjectById(A.getId(R)),'x'),2)
//     // all sides have the same value
//     t.equal(A.getPropertyValue(A.getObjectById(A.getId(R)),'y'),20)
//     t.equal(Server.getPropertyValue(Server.getObjectById(A.getId(R)),'y'),20)
//     t.equal(B.getPropertyValue(B.getObjectById(A.getId(R)),'y'),20)
// })

// set property on a deleted object. Confirm that the final tree snapshot is correct.
// test('invalid property setting',t => {
//     const sync = new Sync()
//
//     const R = sync.createObject()
//     sync.createProperty(R,'id','R')
//     sync.createProperty(R,'x',100)
//     sync.setProperty(R,'x',200)
//     t.deepEquals(sync.dump(),{
//         R: {
//             id:'R',
//             x:200
//         }
//     })
//     sync.deleteObject(R)
//     sync.setProperty(R,'x',300)
//     t.deepEquals(sync.dump(),{})
// })